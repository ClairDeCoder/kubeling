import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.config import (
    MAX_CONCURRENT_KUBELINGS,
    HEARTBEAT_INTERVAL,
    FEED_FULLNESS_BOOST,
    PET_MOOD_BOOST,
    STAT_START_VALUE,
    APP_HOST,
    APP_PORT,
)
from backend.models import Kubeling
from backend.kubeling import run_lifecycle, _state
from backend.db import save_death

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

active: dict[str, Kubeling] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # spin down gracefully on shutdown
    for k in list(active.values()):
        if k.alive:
            k.die("disconnected")
            try:
                save_death(k)
            except Exception:
                pass


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/")
async def index():
    return FileResponse("frontend/index.html")


@app.get("/stats")
async def stats():
    return {
        "alive_count": len(active),
        "kubelings": [
            {
                "name":     k.name,
                "color":    k.color,
                "fullness": round(k.fullness, 1),
                "mood":     round(k.mood, 1),
                "sleeping": k.sleeping,
            }
            for k in active.values()
        ],
    }


@app.get("/metrics")
async def metrics():
    # Placeholder — Prometheus exposition format added in observability phase
    alive = len(active)
    return {"kubelings_alive": alive}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    if len(active) >= MAX_CONCURRENT_KUBELINGS:
        await ws.send_json({"type": "error", "message": "Server at capacity. Try again later."})
        await ws.close()
        return

    try:
        # First message must be spawn payload
        raw = await ws.receive_text()
        data = json.loads(raw)
        assert data.get("type") == "spawn"
        name  = str(data["name"]).strip()[:32]
        color = str(data["color"]).strip()[:16]
    except Exception:
        await ws.close()
        return

    kubeling = Kubeling(name=name, color=color,
                        fullness=STAT_START_VALUE, mood=STAT_START_VALUE)
    active[name] = kubeling
    log.info("Spawned: %s (%s)", name, color)

    await ws.send_json({"type": "spawned", **_state(kubeling)})

    async def send_state(state: dict):
        try:
            await ws.send_json(state)
        except Exception:
            pass

    async def on_death(k: Kubeling):
        await send_state({
            "type":             "death",
            "cause_of_death":   k.cause_of_death,
            "lifespan_seconds": k.lifespan_seconds(),
            "peak_fullness":    int(k.peak_fullness),
            "peak_mood":        int(k.peak_mood),
        })
        try:
            save_death(k)
        except Exception as e:
            log.warning("DynamoDB write failed: %s", e)
        active.pop(k.name, None)

    lifecycle = asyncio.create_task(run_lifecycle(kubeling, send_state, on_death))
    heartbeat = asyncio.create_task(_heartbeat(ws, kubeling))

    try:
        async for message in ws.iter_text():
            data = json.loads(message)
            action = data.get("action")
            if action == "feed" and kubeling.alive and not kubeling.sleeping:
                kubeling.feed(FEED_FULLNESS_BOOST)
                await send_state(_state(kubeling))
            elif action == "pet" and kubeling.alive and not kubeling.sleeping:
                kubeling.pet(PET_MOOD_BOOST)
                await send_state(_state(kubeling))
    except WebSocketDisconnect:
        pass
    finally:
        lifecycle.cancel()
        heartbeat.cancel()
        if kubeling.alive:
            kubeling.die("disconnected")
            try:
                save_death(kubeling)
            except Exception as e:
                log.warning("DynamoDB write failed on disconnect: %s", e)
        active.pop(kubeling.name, None)
        log.info("Disconnected: %s", kubeling.name)


async def _heartbeat(ws: WebSocket, kubeling: Kubeling):
    while kubeling.alive:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        try:
            await ws.send_json({"type": "ping"})
        except Exception:
            break


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=APP_HOST, port=APP_PORT, reload=True)
