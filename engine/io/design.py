"""Declarative assembly authoring for application agents; no executable input."""
import json
from pydantic import Field
from engine.base.contract import Contract, Id, Revision
from engine.components import Component, assemble_components
from engine.schema.component import ComponentDefinition
from engine.schema.assembly import AssemblyDefinition, Connections, ModelBundle
from engine.schema.scenario import Scenario
from engine.interface.motion import Joint, Transmission
from engine.base.identity import DefinitionRef
from engine.io.save import content_hash
from engine.compiler.lower import compile_model


class AssemblyDesign(Contract):
    design_version: int = Field(default=1, ge=1, le=1)
    id: Id
    name: str
    components: dict[Id, Component | ComponentDefinition] = Field(min_length=1, max_length=32)
    connections: Connections = Field(default_factory=Connections)
    joints: dict[Id, Joint] = Field(default_factory=dict)
    transmissions: dict[Id, Transmission] = Field(default_factory=dict)
    input_revisions: dict[str, Revision] = Field(default_factory=dict)


def compose_design(design, scenario):
    source = AssemblyDesign.model_validate_json(json.dumps(design, allow_nan=False))
    bundle = assemble_components(id=source.id, name=source.name,
                                 components=source.components, connections=source.connections)
    assembly = AssemblyDefinition.model_validate_json(json.dumps({
        **bundle.assemblies[0].model_dump(mode="json"),
        "joints": {key: value.model_dump(mode="json") for key, value in source.joints.items()},
        "transmissions": {key: value.model_dump(mode="json") for key, value in source.transmissions.items()},
    }))
    bundle = ModelBundle(components=bundle.components, assemblies=(assembly,),
        root=DefinitionRef(id=assembly.id, revision=assembly.revision, content_hash=content_hash(assembly)),
        input_revisions=source.input_revisions)
    ir = compile_model(bundle)
    # The host pins the snapshot; agents never invent hashes or silently rebind an old Scenario.
    if not isinstance(scenario, dict) or "snapshot_id" in scenario:
        raise ValueError("Author a scenario without snapshot_id; compose pins it")
    scene = Scenario.model_validate_json(json.dumps({**scenario, "snapshot_id": ir.snapshot_id}, allow_nan=False))
    return {"bundle": bundle.model_dump(mode="json"), "scenario": scene.model_dump(mode="json")}
