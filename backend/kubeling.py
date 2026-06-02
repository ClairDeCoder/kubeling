import asyncio
import logging
from backend.models import Kubeling
from backend.config import (
    DECAY_INTERVAL_SECONDS,
    FULLNESS_DECAY_AMOUNT,
    MOOD_DECAY_AMOUNT,
    SLEEP_DECAY_MULTIPLIER,
    TIREDNESS_INCREASE_AMOUNT,
    TIREDNESS_REFILL_AMOUNT,
)

log = logging.getLogger(__name__)


async def run_lifecycle(kubeling: Kubeling, send_state, on_death):
    """
    Drives the full lifecycle for one Kubeling:
    - stat decay loop
    - tiredness accumulation / sleep refill
    - auto-wake when fully rested
    - death detection
    """
    while kubeling.alive:
        await asyncio.sleep(DECAY_INTERVAL_SECONDS)

        multiplier = SLEEP_DECAY_MULTIPLIER if kubeling.sleeping else 1.0
        kubeling.tick(FULLNESS_DECAY_AMOUNT, MOOD_DECAY_AMOUNT, multiplier)

        if kubeling.sleeping:
            kubeling.tiredness = max(0.0, kubeling.tiredness - TIREDNESS_REFILL_AMOUNT)
            if kubeling.tiredness == 0.0:
                kubeling.sleeping = False
                log.debug("%s woke up (fully rested)", kubeling.name)
        else:
            kubeling.tiredness = min(100.0, kubeling.tiredness + TIREDNESS_INCREASE_AMOUNT)

        if kubeling.fullness <= 0:
            kubeling.die("hunger")
        elif kubeling.mood <= 0:
            kubeling.die("boredom")
        elif kubeling.tiredness >= 100:
            kubeling.die("sleep_deprivation")

        await send_state(_state(kubeling))

        if not kubeling.alive:
            await on_death(kubeling)
            return


def _state(kubeling: Kubeling) -> dict:
    return {
        "type":      "state",
        "name":      kubeling.name,
        "color":     kubeling.color,
        "fullness":  round(kubeling.fullness, 1),
        "mood":      round(kubeling.mood, 1),
        "tiredness": round(kubeling.tiredness, 1),
        "sleeping":  kubeling.sleeping,
        "alive":     kubeling.alive,
        "cause_of_death": kubeling.cause_of_death,
    }
