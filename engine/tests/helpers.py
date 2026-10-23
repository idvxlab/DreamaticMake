from engine.examples.build_examples import parse, definition_ref
from element.schema.model import ComponentDefinition
from engine.schema.assembly import ModelBundle
from engine.schema.scenario import Scenario
from engine.compiler.lower import compile_model


def single(data, scenario=None):
    component = parse(ComponentDefinition, {"id": "test.component", "name": "Test component", **data})
    bundle = parse(ModelBundle, {"components": [component.model_dump(mode="json")], "root": definition_ref(component)})
    ir = compile_model(bundle)
    run = parse(Scenario, {"id": "test", "snapshot_id": ir.snapshot_id, "duration_s": 0.2, **(scenario or {})})
    return ir, run
