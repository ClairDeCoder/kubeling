import asyncio
import random
import logging
from backend.models import Kubeling
from backend.config import (
    DECAY_INTERVAL_SECONDS,
    FULLNESS_DECAY_AMOUNT,
    MOOD_DECAY_AMOUNT,
    SLEEP_INTERVAL_MIN,
    SLEEP_INTERVAL_MAX,
    SLEEP_DURATION_MIN,
    SLEEP_DURATION_MAX,
    SLEEP_DECAY_MULTIPLIER,
)

log = logging.getLogger(__name__)


async def run_lifecycle(kubeling: Kubeling, send_state, on_death):
    """
    Drives the full lifecycle for one Kubeling:
    - decay loop
    - randomised sleep cycles
    - death detection

    send_state(dict) — coroutine that pushes state to the WebSocket client
    on_death(kubeling) — coroutine called when the Kubeling dies in-game
    """
    asyncio.create_task(_sleep_cycle(kubeling, send_state))

    while kubeling.alive:
        await asyncio.sleep(DECAY_INTERVAL_SECONDS)

        multiplier = SLEEP_DECAY_MULTIPLIER if kubeling.sleeping else 1.0
        kubeling.tick(FULLNESS_DECAY_AMOUNT, MOOD_DECAY_AMOUNT, multiplier)

        if kubeling.fullness <= 0:
            kubeling.die("hunger")
        elif kubeling.mood <= 0:
            kubeling.die("boredom")

        await send_state(_state(kubeling))

        if not kubeling.alive:
            await on_death(kubeling)
            return


async def _sleep_cycle(kubeling: Kubeling, send_state):
    while kubeling.alive:
        await asyncio.sleep(random.uniform(SLEEP_INTERVAL_MIN, SLEEP_INTERVAL_MAX))
        if not kubeling.alive:
            return

        kubeling.sleeping = True
        await send_state(_state(kubeling))
        log.debug("%s fell asleep", kubeling.name)

        await asyncio.sleep(random.uniform(SLEEP_DURATION_MIN, SLEEP_DURATION_MAX))
        kubeling.sleeping = False
        await send_state(_state(kubeling))
        log.debug("%s woke up", kubeling.name)


def _state(kubeling: Kubeling) -> dict:
    return {
        "type":      "state",
        "name":      kubeling.name,
        "color":     kubeling.color,
        "fullness":  round(kubeling.fullness, 1),
        "mood":      round(kubeling.mood, 1),
        "sleeping":  kubeling.sleeping,
        "alive":     kubeling.alive,
        "cause_of_death": kubeling.cause_of_death,
    }
