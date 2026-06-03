import asyncio
import json
import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from backend.config import (
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

NAME  = os.getenv("KUBELING_NAME",  "Unknown")
COLOR = os.getenv("KUBELING_COLOR", "slate")

app = FastAPI()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()

    kubeling = Kubeling(name=NAME, color=COLOR,
                        fullness=STAT_START_VALUE, mood=STAT_START_VALUE)
    log.info("Pod started: %s (%s)", NAME, COLOR)

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
        })
        try:
            save_death(k)
        except Exception as e:
            log.warning("DynamoDB write failed: %s", e)
        try:
            await ws.close()
        except Exception:
            pass

    await ws.send_json({**_state(kubeling), "type": "spawned"})

    lifecycle = asyncio.create_task(run_lifecycle(kubeling, send_state, on_death))
    heartbeat = asyncio.create_task(_heartbeat(ws, kubeling))

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
            try:
                save_death(kubeling)
            except Exception as e:
                log.warning("DynamoDB write failed on disconnect: %s", e)
        log.info("Pod finished: %s cause=%s", NAME, kubeling.cause_of_death)


async def _heartbeat(ws: WebSocket, kubeling: Kubeling):
    while kubeling.alive:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        try:
            await ws.send_json({"type": "ping"})
        except Exception:
            break


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.pod.main:app", host=APP_HOST, port=APP_PORT, reload=False)
