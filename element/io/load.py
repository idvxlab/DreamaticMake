import hashlib
import json
from pathlib import Path
from element.base.reference import AssetRef
MAX_BYTES = 16 * 1024 * 1024

def read_record(path: str | Path) -> str:
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Model JSON exceeds the 16 MiB input limit")
    return data.decode("utf-8")

def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result

def _nonfinite(value):
    raise ValueError(f"Non-finite JSON number: {value}")

def _record_object(text: str) -> dict:
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValueError("Model JSON exceeds the 16 MiB input limit")
    data = json.loads(text, object_pairs_hook=_unique, parse_constant=_nonfinite)
    if not isinstance(data, dict):
        raise ValueError("A record must be a JSON object")
    return data

def read_asset(ref: AssetRef, root: Path, max_bytes: int = MAX_BYTES) -> bytes:
    """Resolve local library assets only; the application must resolve Artifact IDs."""
    if ref.relative_path is None:
        raise ValueError("Artifact IDs must be resolved by the owning application")
    root = root.resolve(strict=True)
    target = (root / ref.relative_path).resolve(strict=True)
    if not target.is_relative_to(root):
        raise ValueError("Asset escapes the library root")
    with target.open("rb") as stream:
        data = stream.read(max_bytes + 1)
    if len(data) > max_bytes or hashlib.sha256(data).hexdigest() != ref.sha256:
        raise ValueError("Asset size limit or SHA-256 verification failed")
    return data
