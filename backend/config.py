import os
from dotenv import load_dotenv

load_dotenv()

DECAY_INTERVAL_SECONDS   = float(os.getenv("DECAY_INTERVAL_SECONDS", 60))
FULLNESS_DECAY_AMOUNT    = float(os.getenv("FULLNESS_DECAY_AMOUNT", 3))
MOOD_DECAY_AMOUNT        = float(os.getenv("MOOD_DECAY_AMOUNT", 3))
FEED_FULLNESS_BOOST      = float(os.getenv("FEED_FULLNESS_BOOST", 30))
PET_MOOD_BOOST           = float(os.getenv("PET_MOOD_BOOST", 30))
STAT_START_VALUE         = float(os.getenv("STAT_START_VALUE", 100))

SLEEP_INTERVAL_MIN       = float(os.getenv("SLEEP_INTERVAL_MIN_SECONDS", 300))
SLEEP_INTERVAL_MAX       = float(os.getenv("SLEEP_INTERVAL_MAX_SECONDS", 600))
SLEEP_DURATION_MIN       = float(os.getenv("SLEEP_DURATION_MIN_SECONDS", 30))
SLEEP_DURATION_MAX       = float(os.getenv("SLEEP_DURATION_MAX_SECONDS", 90))
SLEEP_DECAY_MULTIPLIER   = float(os.getenv("SLEEP_DECAY_MULTIPLIER", 0.25))

MAX_CONCURRENT_KUBELINGS = int(os.getenv("MAX_CONCURRENT_KUBELINGS", 100))
HEARTBEAT_INTERVAL       = float(os.getenv("HEARTBEAT_INTERVAL_SECONDS", 15))

DYNAMODB_TABLE_NAME      = os.getenv("DYNAMODB_TABLE_NAME", "kubelings")
DYNAMODB_ENDPOINT_URL    = os.getenv("DYNAMODB_ENDPOINT_URL")  # None in prod
AWS_REGION               = os.getenv("AWS_REGION", "us-east-1")

APP_HOST                 = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT                 = int(os.getenv("APP_PORT", 8000))
