from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Kubeling:
    name: str
    color: str
    born_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    fullness: float = 100.0
    mood: float = 100.0
    tiredness: float = 0.0
    sleeping: bool = False
    alive: bool = True
    cause_of_death: str | None = None

    def tick(self, fullness_decay: float, mood_decay: float, multiplier: float = 1.0):
        self.fullness = max(0.0, self.fullness - fullness_decay * multiplier)
        self.mood     = max(0.0, self.mood     - mood_decay     * multiplier)
    def feed(self, amount: float):
        self.fullness = min(100.0, self.fullness + amount)

    def pet(self, amount: float):
        self.mood = min(100.0, self.mood + amount)

    def die(self, cause: str):
        self.alive = False
        self.cause_of_death = cause

    def lifespan_seconds(self) -> int:
        return int((datetime.now(timezone.utc) - self.born_at).total_seconds())
