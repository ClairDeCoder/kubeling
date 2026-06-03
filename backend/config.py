import os
from dotenv import load_dotenv

load_dotenv()

DECAY_INTERVAL_SECONDS   = float(os.getenv("DECAY_INTERVAL_SECONDS", 5))
FULLNESS_DECAY_AMOUNT    = float(os.getenv("FULLNESS_DECAY_AMOUNT", 3))
MOOD_DECAY_AMOUNT        = float(os.getenv("MOOD_DECAY_AMOUNT", 3))
FEED_FULLNESS_BOOST      = float(os.getenv("FEED_FULLNESS_BOOST", 30))
PET_MOOD_BOOST           = float(os.getenv("PET_MOOD_BOOST", 30))
STAT_START_VALUE         = float(os.getenv("STAT_START_VALUE", 100))

SLEEP_DECAY_MULTIPLIER   = float(os.getenv("SLEEP_DECAY_MULTIPLIER", 0.25))
TIREDNESS_INCREASE_AMOUNT = float(os.getenv("TIREDNESS_INCREASE_AMOUNT", 2))   # per tick while awake
TIREDNESS_REFILL_AMOUNT   = float(os.getenv("TIREDNESS_REFILL_AMOUNT",   8))   # per tick while sleeping

MAX_CONCURRENT_KUBELINGS = int(os.getenv("MAX_CONCURRENT_KUBELINGS", 100))
HEARTBEAT_INTERVAL       = float(os.getenv("HEARTBEAT_INTERVAL_SECONDS", 15))

DYNAMODB_TABLE_NAME      = os.getenv("DYNAMODB_TABLE_NAME", "kubelings")
DYNAMODB_ENDPOINT_URL    = os.getenv("DYNAMODB_ENDPOINT_URL")  # None in prod
AWS_REGION               = os.getenv("AWS_REGION", "us-east-1")

APP_HOST                 = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT                 = int(os.getenv("APP_PORT", 8000))

# ── Spawner / pod architecture ─────────────────────────────────────────────────
# True  → run kubeling in-process (local dev, no K8s needed)
# False → create a real K8s pod per connection (prod)
LOCAL_DEV     = os.getenv("LOCAL_DEV", "true").lower() == "true"
POD_IMAGE     = os.getenv("POD_IMAGE", "kubeling:local")   # overridden in prod with ECR URL
POD_PORT      = int(os.getenv("POD_PORT", 3001))           # port the kubeling pod listens on
K8S_NAMESPACE = os.getenv("K8S_NAMESPACE", "default")
