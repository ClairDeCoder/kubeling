import boto3
from datetime import datetime, timezone
from backend.config import DYNAMODB_TABLE_NAME, DYNAMODB_ENDPOINT_URL, AWS_REGION
from backend.models import Kubeling


def _table():
    kwargs = {"region_name": AWS_REGION}
    if DYNAMODB_ENDPOINT_URL:
        kwargs["endpoint_url"] = DYNAMODB_ENDPOINT_URL
    dynamo = boto3.resource("dynamodb", **kwargs)
    return dynamo.Table(DYNAMODB_TABLE_NAME)


def save_death(kubeling: Kubeling):
    died_at = datetime.now(timezone.utc).isoformat()
    _table().put_item(Item={
        "kubeling_name":    kubeling.name,
        "color":            kubeling.color,
        "born_at":          kubeling.born_at.isoformat(),
        "died_at":          died_at,
        "alive":            False,
        "lifespan_seconds": kubeling.lifespan_seconds(),
        "cause_of_death":   kubeling.cause_of_death,
        "peak_mood":        int(kubeling.peak_mood),
        "peak_fullness":    int(kubeling.peak_fullness),
    })
