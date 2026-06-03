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
        "alive":            "false",
        "lifespan_seconds": kubeling.lifespan_seconds(),
        "cause_of_death":   kubeling.cause_of_death,
    })


def get_stats() -> dict:
    table = _table()
    items = []
    kwargs: dict = {"ProjectionExpression": "lifespan_seconds, cause_of_death"}
    while True:
        response = table.scan(**kwargs)
        items.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    lifespans = [float(i["lifespan_seconds"]) for i in items if "lifespan_seconds" in i]
    cause_counts: dict[str, int] = {}
    for i in items:
        cause = i.get("cause_of_death", "unknown")
        cause_counts[cause] = cause_counts.get(cause, 0) + 1

    return {
        "total_dead":    len(items),
        "avg_lifespan":  sum(lifespans) / len(lifespans) if lifespans else 0.0,
        "max_lifespan":  max(lifespans) if lifespans else 0.0,
        "deaths_by_cause": cause_counts,
    }
