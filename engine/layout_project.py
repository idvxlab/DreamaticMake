"""Compose reusable component definitions and separate design layers into a layout.

This interface takes inline records only. The owning application resolves files.
"""
import json
from pydantic import Field, model_validator
from typing import Literal
from engine.base.contract import Contract, Id
from engine.base.frame import Pose
from engine.layout import DraftJoint, DraftTransmission, Port, Edge, PathCheck, parse_layout


class Instance(Contract):
    definition: Id
    name: str | None = None
    pose: Pose = Pose()


class StructureLayer(Contract):
    instances: dict[Id, Instance] = Field(min_length=1, max_length=64)


class MotionLayer(Contract):
    joints: dict[str, DraftJoint] = Field(default_factory=dict)
    transmissions: dict[str, DraftTransmission] = Field(default_factory=dict)


class GraphLayer(Contract):
    ports: dict[str, Port] = Field(default_factory=dict)
    edges: dict[str, Edge] = Field(default_factory=dict)
    paths: tuple[PathCheck, ...] = ()


class LayoutProject(Contract):
    record_kind: Literal["layout_project"] = "layout_project"
    project_version: Literal[1] = 1
    components: dict[Id, dict] = Field(min_length=1, max_length=64)
    structure: StructureLayer
    motion: MotionLayer = MotionLayer()
    circuit_energy: GraphLayer = GraphLayer()
    flow: GraphLayer = GraphLayer()

    @model_validator(mode="after")
    def domains(self):
        for layer, allowed in ((self.circuit_energy, {"electrical"}), (self.flow, {"material", "information"})):
            if any(item.domain not in allowed for item in (*layer.ports.values(), *layer.edges.values(), *layer.paths)):
                raise ValueError("Graph record is in the wrong design layer")
        return self


def compose_project(source):
    from engine.layout import import_layout, motion
    project = LayoutProject.model_validate_json(json.dumps(source, allow_nan=False))
    result = parse_layout({}).model_dump(mode="json")
    definitions = {}
    for key, component in project.components.items():
        if component.get("record_kind") != "component_design":
            raise ValueError("Project definitions must use component_design")
        definitions[key] = import_layout(component)
    def put(collection, key, value):
        if key in result[collection]:
            raise ValueError("Design layers cannot overwrite objects: " + key)
        result[collection][key] = value
    for instance, placement in project.structure.instances.items():
        if placement.definition not in definitions:
            raise ValueError("Unknown component definition: " + placement.definition)
        component = definitions[placement.definition]
        ref = lambda key: f"{instance}/{key}"
        entity = next(iter(component["entities"].values()))
        put("entities", instance, {**entity, "name": placement.name or entity["name"]})
        for key, body in component["bodies"].items():
            pose = placement.pose.compose(Pose.model_validate_json(json.dumps(body["pose"])))
            put("bodies", ref(key), {"entity": instance, "pose": pose.model_dump(mode="json")})
        for key, env in component["envelopes"].items():
            put("envelopes", ref(key), {**env, "body": ref(env["body"])})
        for key, port in component["ports"].items():
            put("ports", ref(key), {**port, "entity": instance, "body": ref(port["body"]) if port["body"] else None})
        for key, edge in component["edges"].items():
            put("edges", ref(key), {**edge, "members": [ref(member) for member in edge["members"]]})
        for key, joint in component["joints"].items():
            put("joints", ref(key), {**joint, "parent": ref(joint["parent"]), "child": ref(joint["child"])})
        for key, transmission in component["transmissions"].items():
            put("transmissions", ref(key), {**transmission, "driver": ref(transmission["driver"]), "follower": ref(transmission["follower"])})
        result["paths"].extend({**path, "source": ref(path["source"]), "target": ref(path["target"])} for path in component["paths"])
    for collection in ("joints", "transmissions"):
        for key, value in getattr(project.motion, collection).items():
            put(collection, key, value.model_dump(mode="json"))
    for layer in (project.circuit_energy, project.flow):
        for collection in ("ports", "edges"):
            for key, value in getattr(layer, collection).items():
                put(collection, key, value.model_dump(mode="json"))
        result["paths"].extend(path.model_dump(mode="json") for path in layer.paths)
    draft = parse_layout(result)
    poses, _ = motion(draft, {})
    for key, pose in poses.items(): result["bodies"][key]["pose"] = pose.model_dump(mode="json")
    return parse_layout(result).model_dump(mode="json")
