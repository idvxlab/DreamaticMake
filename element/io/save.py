import hashlib
import json
import os
import tempfile
from pathlib import Path
from pydantic import BaseModel


def canonical_json(record: BaseModel | dict) -> str:
    data = record.model_dump(mode="json") if isinstance(record, BaseModel) else record
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def content_hash(record: BaseModel | dict) -> str:
    return hashlib.sha256(canonical_json(record).encode("utf-8")).hexdigest()


def dumps(record: BaseModel) -> str:
    return json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"


def save(record: BaseModel, path: str | Path, *, overwrite: bool = False) -> None:
    """Explicit destination only; existing definitions are never overwritten by default."""
    target = Path(path)
    data = dumps(record)
    if not overwrite:
        with target.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(data)
        return
    fd, name = tempfile.mkstemp(prefix=".engine-", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)
