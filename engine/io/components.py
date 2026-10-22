"""Safe category dispatch for mappings, JSON and TOML (Python 3.11+ for TOML)."""
import json
from pathlib import Path
from collections.abc import Mapping
from engine.components import ComponentDesign, COMPONENT_ADAPTER


def parse_component(data: Mapping | ComponentDesign) -> ComponentDesign:
    from engine.io.load import MAX_BYTES
    if isinstance(data, ComponentDesign):
        text = data.model_dump_json()
    elif isinstance(data, Mapping):
        text = json.dumps(dict(data), allow_nan=False)
    else:
        raise TypeError("Expected a component design or mapping")
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValueError("Component design exceeds the 16 MiB input limit")
    return COMPONENT_ADAPTER.validate_json(text)


def load_component(path: str | Path) -> ComponentDesign:
    from engine.io.load import MAX_BYTES, _unique, _nonfinite
    path = Path(path)
    if path.suffix.lower() not in (".json", ".toml"):
        raise ValueError("Component files must be JSON or TOML; Python scripts are never loaded")
    with path.open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Component design exceeds the 16 MiB input limit")
    if path.suffix.lower() == ".toml":
        import tomllib
        record = tomllib.loads(data.decode("utf-8"))
    else:
        record = json.loads(data, object_pairs_hook=_unique, parse_constant=_nonfinite)
    return parse_component(record)
