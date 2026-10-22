from engine import DSL_VERSION
from engine.io.load import loads


def migrate(text: str):
    """Only identity migration is supported; never invent missing v1 engineering facts."""
    import json
    version = json.loads(text).get("dsl_version")
    if version != DSL_VERSION:
        raise ValueError(f"Migration from {version!r} requires an explicit reviewed mapping")
    return loads(text)
