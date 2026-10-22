"""Create a self-contained static assembly from explicitly supplied STL references."""
import json
from engine.base.contract import Contract, Id
from engine.base.frame import Pose
from engine.interface.geometry import TriangleMesh
from engine.schema.component import ComponentDefinition
from engine.schema.assembly import ModelBundle
from engine.schema.scenario import Scenario
from engine.io.save import content_hash
from engine.compiler.lower import compile_model


class MeshInstance(Contract):
    id: Id
    shape: TriangleMesh
    world_pose: Pose = Pose()


def mesh_bundle(entries):
    instances = [MeshInstance.model_validate_json(json.dumps(e, allow_nan=False)) for e in entries]
    if not 1 <= len(instances) <= 32 or len({e.id for e in instances}) != len(instances):
        raise ValueError("Supply 1–32 mesh instances with unique IDs")
    component = ComponentDefinition.model_validate_json(json.dumps({
        "id": "imported.stl_assembly", "name": "Imported STL assembly",
        "physical": {"geometry": {"root_body": instances[0].id,
            "bodies": {e.id: {"description": "Imported STL; user-declared units and placement"} for e in instances},
            "envelopes": {e.id: {"body_ref": e.id, "shape": e.shape.model_dump(mode="json"),
                "approximation": "unknown"} for e in instances}}}}))
    bundle = ModelBundle.model_validate_json(json.dumps({"components": [component.model_dump(mode="json")],
        "root": {"id": component.id, "revision": component.revision, "content_hash": content_hash(component)}}))
    ir = compile_model(bundle)
    scenario = Scenario.model_validate_json(json.dumps({"id": "stl_inspection", "snapshot_id": ir.snapshot_id,
        "duration_s": 0.0, "roots": [{"body_ref": {"collection": "bodies", "object_id": e.id},
            "world_pose": e.world_pose.model_dump(mode="json")} for e in instances]}))
    return {"bundle": bundle.model_dump(mode="json"), "scenario": scenario.model_dump(mode="json")}
