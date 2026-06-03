import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from functools import partial

import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from prometheus_client import Gauge, generate_latest, CONTENT_TYPE_LATEST

from backend.config import (
    APP_HOST,
    APP_PORT,
    HEARTBEAT_INTERVAL,
    MAX_CONCURRENT_KUBELINGS,
    LOCAL_DEV,
    POD_IMAGE,
    POD_PORT,
    K8S_NAMESPACE,
    FEED_FULLNESS_BOOST,
    PET_MOOD_BOOST,
    STAT_START_VALUE,
)
from backend.kubeling import run_lifecycle, _state
from backend.models import Kubeling
from backend.db import save_death, get_stats

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ── K8s client (only imported in prod) ────────────────────────────────────────
if not LOCAL_DEV:
    from kubernetes import client as k8s_client, config as k8s_config
    try:
        k8s_config.load_incluster_config()
    except Exception:
        k8s_config.load_kube_config()
    v1 = k8s_client.CoreV1Api()

# ── Local dev state (no K8s) ───────────────────────────────────────────────────
_active: dict[str, Kubeling] = {}

# ── Prometheus metrics ─────────────────────────────────────────────────────────
_gauge_alive    = Gauge("kubelings_alive",               "Currently active Kubelings")
_gauge_dead     = Gauge("kubelings_total_dead",          "Total Kubelings that have died")
_gauge_avg_life = Gauge("kubeling_avg_lifespan_seconds", "Average Kubeling lifespan in seconds")
_gauge_max_life = Gauge("kubeling_max_lifespan_seconds", "Longest Kubeling lifespan in seconds")
_gauge_cause    = Gauge("kubeling_deaths_by_cause",      "Deaths by cause", ["cause"])


async def _refresh_dynamo_metrics() -> None:
    while True:
        try:
            loop = asyncio.get_event_loop()
            stats = await loop.run_in_executor(None, get_stats)
            _gauge_dead.set(stats["total_dead"])
            _gauge_avg_life.set(stats["avg_lifespan"])
            _gauge_max_life.set(stats["max_lifespan"])
            for cause, count in stats["deaths_by_cause"].items():
                _gauge_cause.labels(cause=cause).set(count)
        except Exception as e:
            log.warning("Metrics refresh failed: %s", e)
        await asyncio.sleep(60)


# ── K8s helpers ───────────────────────────────────────────────────────────────
def _create_pod_sync(pod_name: str, pod_id: str, name: str, color: str) -> None:
    pod = k8s_client.V1Pod(
        metadata=k8s_client.V1ObjectMeta(
            name=pod_name,
            namespace=K8S_NAMESPACE,
            labels={
                "app":            "kubeling-pod",
                "pod-id":         pod_id,
                "kubeling-name":  name[:63],
                "kubeling-color": color[:63],
            },
        ),
        spec=k8s_client.V1PodSpec(
            service_account_name="kubeling-pod",
            containers=[k8s_client.V1Container(
                name="kubeling",
                image=POD_IMAGE,
                command=["uvicorn", "backend.pod.main:app", "--host", "0.0.0.0", "--port", str(POD_PORT)],
                ports=[k8s_client.V1ContainerPort(container_port=POD_PORT)],
                env=[
                    k8s_client.V1EnvVar(name="KUBELING_NAME",  value=name),
                    k8s_client.V1EnvVar(name="KUBELING_COLOR", value=color),
                    k8s_client.V1EnvVar(name="APP_PORT",       value=str(POD_PORT)),
                ],
                resources=k8s_client.V1ResourceRequirements(
                    requests={"cpu": "50m",  "memory": "64Mi"},
                    limits=  {"cpu": "200m", "memory": "128Mi"},
                ),
            )],
            restart_policy="Never",
        ),
    )
    v1.create_namespaced_pod(namespace=K8S_NAMESPACE, body=pod)


def _delete_pod_sync(pod_name: str) -> None:
    try:
        v1.delete_namespaced_pod(name=pod_name, namespace=K8S_NAMESPACE)
    except Exception as e:
        log.warning("Pod delete failed (%s): %s", pod_name, e)


async def _wait_for_pod_ready(pod_name: str, timeout: float = 30.0) -> str:
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        pod = await loop.run_in_executor(
            None, partial(v1.read_namespaced_pod, name=pod_name, namespace=K8S_NAMESPACE)
        )
        statuses = pod.status.container_statuses or []
        if pod.status.phase == "Running" and pod.status.pod_ip and all(c.ready for c in statuses):
            return pod.status.pod_ip
        await asyncio.sleep(0.5)
    raise TimeoutError(f"Pod {pod_name} not ready after {timeout}s")


async def _connect_to_pod(pod_ip: str, retries: int = 10, delay: float = 0.5):
    url = f"ws://{pod_ip}:{POD_PORT}/ws"
    last_exc = None
    for _ in range(retries):
        try:
            return await websockets.connect(url)
        except Exception as e:
            last_exc = e
            await asyncio.sleep(delay)
    raise ConnectionError(f"Could not connect to pod at {url}: {last_exc}")


# ── Session handlers ───────────────────────────────────────────────────────────
async def _handle_local(ws: WebSocket, name: str, color: str) -> None:
    """LOCAL_DEV: run kubeling in-process, no K8s."""
    kubeling = Kubeling(name=name, color=color,
                        fullness=STAT_START_VALUE, mood=STAT_START_VALUE)
    _active[name] = kubeling

    async def send_state(state: dict):
        try: await ws.send_json(state)
        except Exception: pass

    async def on_death(k: Kubeling):
        await send_state({
            "type":             "death",
            "cause_of_death":   k.cause_of_death,
            "lifespan_seconds": k.lifespan_seconds(),
        })
        try: save_death(k)
        except Exception as e: log.warning("DynamoDB: %s", e)
        _active.pop(k.name, None)

    await ws.send_json({**_state(kubeling), "type": "spawned"})
    lifecycle = asyncio.create_task(run_lifecycle(kubeling, send_state, on_death))
    heartbeat = asyncio.create_task(_heartbeat_local(ws, kubeling))

    try:
        async for message in ws.iter_text():
            data = json.loads(message)
            if data.get("type") == "pong":
                continue
            action = data.get("action")
            if action == "feed" and kubeling.alive and not kubeling.sleeping:
                kubeling.feed(FEED_FULLNESS_BOOST)
                await send_state(_state(kubeling))
            elif action == "pet" and kubeling.alive and not kubeling.sleeping:
                kubeling.pet(PET_MOOD_BOOST)
                await send_state(_state(kubeling))
            elif action == "sleep" and kubeling.alive and not kubeling.sleeping and kubeling.tiredness > 0:
                kubeling.sleeping = True
                await send_state(_state(kubeling))
    except WebSocketDisconnect:
        pass
    finally:
        lifecycle.cancel()
        heartbeat.cancel()
        if kubeling.alive:
            kubeling.die("disconnected")
            try: save_death(kubeling)
            except Exception as e: log.warning("DynamoDB: %s", e)
        _active.pop(kubeling.name, None)


async def _handle_pod(ws: WebSocket, name: str, color: str) -> None:
    """Prod: create a real K8s pod and proxy the WebSocket to it."""
    loop     = asyncio.get_event_loop()
    pod_id   = uuid.uuid4().hex[:8]
    pod_name = f"kubeling-{pod_id}"

    await loop.run_in_executor(None, partial(_create_pod_sync, pod_name, pod_id, name, color))
    log.info("Created pod %s for %s", pod_name, name)

    try:
        pod_ip = await _wait_for_pod_ready(pod_name)
        pod_ws = await _connect_to_pod(pod_ip)
    except Exception as e:
        log.error("Pod startup failed for %s: %s", pod_name, e)
        await ws.send_json({"type": "error", "message": "Pod failed to start. Try again."})
        await loop.run_in_executor(None, partial(_delete_pod_sync, pod_name))
        return

    log.info("Proxying %s → pod %s (%s)", name, pod_name, pod_ip)

    async def browser_to_pod():
        try:
            async for msg in ws.iter_text():
                await pod_ws.send(msg)
        except Exception:
            pass

    async def pod_to_browser():
        try:
            async for msg in pod_ws:
                text = msg if isinstance(msg, str) else msg.decode()
                await ws.send_text(text)
        except Exception:
            pass

    try:
        await asyncio.gather(browser_to_pod(), pod_to_browser())
    finally:
        try:
            await pod_ws.close()
        except Exception:
            pass
        await asyncio.sleep(3)
        await loop.run_in_executor(None, partial(_delete_pod_sync, pod_name))
        log.info("Cleaned up pod %s", pod_name)


async def _heartbeat_local(ws: WebSocket, kubeling: Kubeling) -> None:
    while kubeling.alive:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        try:
            await ws.send_json({"type": "ping"})
        except Exception:
            break


# ── App ────────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    metrics_task = asyncio.create_task(_refresh_dynamo_metrics())
    yield
    metrics_task.cancel()
    if LOCAL_DEV:
        for k in list(_active.values()):
            if k.alive:
                k.die("disconnected")
                try: save_death(k)
                except Exception: pass


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/")
async def index():
    return FileResponse("frontend/index.html")


@app.get("/stats")
async def stats():
    if LOCAL_DEV:
        return {
            "alive_count": len(_active),
            "kubelings": [
                {"name": k.name, "color": k.color,
                 "fullness": round(k.fullness, 1), "mood": round(k.mood, 1),
                 "sleeping": k.sleeping}
                for k in _active.values()
            ],
        }
    loop = asyncio.get_event_loop()
    pods = await loop.run_in_executor(
        None,
        partial(v1.list_namespaced_pod, namespace=K8S_NAMESPACE,
                label_selector="app=kubeling-pod", field_selector="status.phase=Running"),
    )
    kubelings = [
        {"name":  p.metadata.labels.get("kubeling-name", "?"),
         "color": p.metadata.labels.get("kubeling-color", "?")}
        for p in pods.items
    ]
    return {"alive_count": len(kubelings), "kubelings": kubelings}


@app.get("/metrics")
async def metrics():
    if LOCAL_DEV:
        _gauge_alive.set(len(_active))
    else:
        loop = asyncio.get_event_loop()
        pods = await loop.run_in_executor(
            None,
            partial(v1.list_namespaced_pod, namespace=K8S_NAMESPACE,
                    label_selector="app=kubeling-pod", field_selector="status.phase=Running"),
        )
        _gauge_alive.set(len(pods.items))
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    # Capacity check
    if LOCAL_DEV:
        count = len(_active)
    else:
        loop = asyncio.get_event_loop()
        pods = await loop.run_in_executor(
            None,
            partial(v1.list_namespaced_pod, namespace=K8S_NAMESPACE,
                    label_selector="app=kubeling-pod"),
        )
        count = len(pods.items)

    if count >= MAX_CONCURRENT_KUBELINGS:
        await ws.send_json({"type": "error", "message": "Server at capacity. Try again later."})
        await ws.close()
        return

    try:
        raw  = await ws.receive_text()
        data = json.loads(raw)
        assert data.get("type") == "spawn"
        name  = str(data["name"]).strip()[:32]
        color = str(data["color"]).strip()[:16]
    except Exception:
        await ws.close()
        return

    log.info("Spawn: %s (%s) [local=%s]", name, color, LOCAL_DEV)

    if LOCAL_DEV:
        await _handle_local(ws, name, color)
    else:
        await _handle_pod(ws, name, color)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=APP_HOST, port=APP_PORT)
