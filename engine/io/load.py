import json
from pathlib import Path
from typing import TypeVar
from pydantic import BaseModel
from element.io.load import _record_object, read_record
from engine.schema.component import ComponentDefinition
from engine.schema.assembly import AssemblyDefinition, ModelBundle
from engine.schema.scenario import Scenario
from engine.schema.result import SimulationResult

T = TypeVar("T", bound=BaseModel)
RECORDS = {"component_definition": ComponentDefinition, "assembly_definition": AssemblyDefinition,
           "model_bundle": ModelBundle, "scenario": Scenario, "simulation_result": SimulationResult}


def loads(text: str, record_type: type[T] | None = None) -> T | BaseModel:
    data = _record_object(text)
    if record_type is None:
        kind = data.get('record_kind')
        if kind == 'element_definition':
            from element.io.records import parse_element
            return parse_element(data)
        if kind in ('design_record', 'design_package', 'design_manifest'):
            from engine.design.io import parse_record, parse_package
            from engine.design.contracts import DesignManifest
            if kind == 'design_record': return parse_record(data)
            if kind == 'design_package': return parse_package(data)
            return DesignManifest.model_validate_json(json.dumps(data, allow_nan=False))
    if record_type is None and data.get("record_kind") == "component_design":
        from element.io.components import parse_component
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
    if kind == 'element_definition':
        from element.io.records import parse_element
        return parse_element(data)
    if kind == "component_design":
        from element.io.components import parse_component
        return parse_component(data)
    if kind != "model_bundle":
        raise ValueError("Expected a model bundle or component design")
    return ModelBundle.model_validate_json(json.dumps(data, allow_nan=False))


def load_model(path: str | Path):
    if Path(path).suffix.lower() == ".toml":
        from element.io.components import load_component
        return load_component(path)
    return loads_model(read_record(path))


def load(path: str | Path, record_type: type[T] | None = None):
    if record_type is None and Path(path).suffix.lower() == ".toml":
        from element.io.components import load_component
        return load_component(path)
    return loads(read_record(path), record_type)
