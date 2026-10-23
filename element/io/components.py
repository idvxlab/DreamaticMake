"""Safe category dispatch for mappings, JSON and TOML (Python 3.11+ for TOML)."""
import json
from pathlib import Path
from collections.abc import Mapping
from element.categories import ComponentDesign, COMPONENT_ADAPTER


def parse_component(data: Mapping | ComponentDesign) -> ComponentDesign:
    from element.io.load import MAX_BYTES
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
    from element.io.load import read_record, _record_object
    path = Path(path)
    if path.suffix.lower() not in (".json", ".toml"):
        raise ValueError("Component files must be JSON or TOML; Python scripts are never loaded")
    text = read_record(path)
    if path.suffix.lower() == ".toml":
        import tomllib
        record = tomllib.loads(text)
    else:
        record = _record_object(text)
    return parse_component(record)
