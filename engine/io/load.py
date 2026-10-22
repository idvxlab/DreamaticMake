import hashlib
import json
from pathlib import Path
from typing import TypeVar
from pydantic import BaseModel
from engine.base.reference import AssetRef
from engine.schema.component import ComponentDefinition
from engine.schema.assembly import AssemblyDefinition, ModelBundle
from engine.schema.scenario import Scenario
from engine.schema.result import SimulationResult

T = TypeVar("T", bound=BaseModel)
RECORDS = {"component_definition": ComponentDefinition, "assembly_definition": AssemblyDefinition,
           "model_bundle": ModelBundle, "scenario": Scenario, "simulation_result": SimulationResult}
MAX_BYTES = 16 * 1024 * 1024


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


def loads(text: str, record_type: type[T] | None = None) -> T | BaseModel:
    data = _record_object(text)
    if record_type is None and data.get("record_kind") == "component_design":
        from engine.io.components import parse_component
        return parse_component(data)
    cls = record_type or RECORDS.get(data.get("record_kind"))
    if cls is None:
        raise ValueError("Unknown record_kind")
    # Re-encoding also rejects overflow numbers such as 1e999.
    return cls.model_validate_json(json.dumps(data, allow_nan=False))


def loads_model(text: str):
    """CLI model input, retaining support for legacy bundles without record_kind."""
    data = _record_object(text)
    kind = data.get("record_kind", "model_bundle")
    if kind == "component_design":
        from engine.io.components import parse_component
        return parse_component(data)
    if kind != "model_bundle":
        raise ValueError("Expected a model bundle or component design")
    return ModelBundle.model_validate_json(json.dumps(data, allow_nan=False))


def load_model(path: str | Path):
    if Path(path).suffix.lower() == ".toml":
        from engine.io.components import load_component
        return load_component(path)
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Model JSON exceeds the 16 MiB input limit")
    return loads_model(data.decode("utf-8"))


def load(path: str | Path, record_type: type[T] | None = None):
    if record_type is None and Path(path).suffix.lower() == ".toml":
        from engine.io.components import load_component
        return load_component(path)
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Model JSON exceeds the 16 MiB input limit")
    return loads(data.decode("utf-8"), record_type)


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
