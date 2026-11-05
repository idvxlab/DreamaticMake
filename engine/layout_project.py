"""Compose reusable component definitions and separate design layers into a layout.

This interface takes inline records only. The owning application resolves files.
"""
import json
from pydantic import Field, model_validator
from typing import Literal
from element.base.contract import Contract, Id
from element.base.frame import Pose
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


class LegacyLayoutProject(Contract):
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


class JointConfiguration(Contract):
    initial: float | None = None
    lower: float | None = None
    upper: float | None = None


class ProjectMotionLayer(MotionLayer):
    configuration: dict[str, JointConfiguration] = Field(default_factory=dict, max_length=256)


class ProjectStructureLayer(Contract):
    placements: dict[Id, Pose] = Field(default_factory=dict, max_length=64)


class ProjectNet(Contract):
    members: tuple[str, ...] = Field(min_length=2, max_length=128)
    kind: Literal['signal', 'power', 'ground'] = 'signal'


class CircuitLogicLayer(Contract):
    nets: dict[Id, ProjectNet] = Field(default_factory=dict, max_length=2000)


class LayoutProject(Contract):
    """Resolved project v2; file and library resolution is explicit in project_io."""
    record_kind: Literal['layout_project'] = 'layout_project'
    project_version: Literal[2] = 2
    elements: dict[Id, dict] = Field(min_length=1, max_length=64)
    element_sources: dict[Id, dict] = Field(default_factory=dict, max_length=64)
    structure: ProjectStructureLayer = ProjectStructureLayer()
    motion: ProjectMotionLayer = ProjectMotionLayer()
    circuit_logic: CircuitLogicLayer = CircuitLogicLayer()


def parse_project(source):
    cls = LegacyLayoutProject if source.get('project_version') == 1 else LayoutProject
    return cls.model_validate_json(json.dumps(source, allow_nan=False))


def compose_project(source):
    from engine.layout import import_layout, motion
    project = parse_project(source)
    result = parse_layout({}).model_dump(mode="json")
    definitions = {}
    components = project.components if isinstance(project, LegacyLayoutProject) else project.elements
    for key, component in components.items():
        if component.get("record_kind") != "component_design":
            raise ValueError("Project definitions must use component_design")
        definitions[key] = import_layout(component)
    def put(collection, key, value):
        if key in result[collection]:
            raise ValueError("Design layers cannot overwrite objects: " + key)
        result[collection][key] = value
    if isinstance(project, LegacyLayoutProject):
        instances = project.structure.instances
    else:
        if set(project.structure.placements) - project.elements.keys():
            raise ValueError('Placement references an unknown element key')
        instances = {key: Instance(definition=key, pose=project.structure.placements.get(key, Pose())) for key in project.elements}
    for instance, placement in instances.items():
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
            data = value.model_dump(mode="json")
            if isinstance(project, LayoutProject):
                for field in ('parent', 'child') if collection == 'joints' else ('driver', 'follower'):
                    data[field] = expand_ref(data[field], 'bodies' if collection == 'joints' else 'joints')
            put(collection, key, data)
    if isinstance(project, LayoutProject):
        for key, configuration in project.motion.configuration.items():
            key = expand_ref(key, 'joints')
            if key not in result['joints'] or result['joints'][key]['kind'] == 'fixed':
                raise ValueError('Configuration requires an existing motion degree of freedom: ' + key)
            original = result['joints'][key]
            updates = configuration.model_dump(exclude_none=True)
            if original['kind'] == 'continuous' and any(k in updates for k in ('lower', 'upper')):
                raise ValueError('Continuous joint has no position limits: ' + key)
            for limit, direction in (('lower', -1), ('upper', 1)):
                if limit in updates and original.get(limit) is not None and direction * updates[limit] > direction * original[limit]:
                    raise ValueError('Project joint range exceeds element limits: ' + key)
            merged = {**original, **updates}
            lower, upper, initial = (merged.get(k) for k in ('lower', 'upper', 'initial'))
            if lower is not None and upper is not None and lower > upper:
                raise ValueError('Joint lower limit exceeds upper limit: ' + key)
            if initial is not None and ((lower is not None and initial < lower) or (upper is not None and initial > upper)):
                raise ValueError('Joint initial position is outside project range: ' + key)
            result['joints'][key] = merged
    layers = (project.circuit_energy, project.flow) if isinstance(project, LegacyLayoutProject) else ()
    for layer in layers:
        for collection in ("ports", "edges"):
            for key, value in getattr(layer, collection).items():
                put(collection, key, value.model_dump(mode="json"))
        result["paths"].extend(path.model_dump(mode="json") for path in layer.paths)
    if isinstance(project, LayoutProject):
        for key, net in project.circuit_logic.nets.items():
            put('edges', 'nets/' + key, {'domain': 'electrical', 'kind': net.kind,
                'members': [expand_ref(ref, 'terminals') for ref in net.members], 'directed': False})
    draft = parse_layout(result)
    if isinstance(project, LayoutProject):
        if any(j.parent not in draft.bodies or j.child not in draft.bodies for j in draft.joints.values()):
            raise ValueError('Motion joint references an unknown element body')
        if any(member not in draft.ports or draft.ports[member].domain != edge.domain
               for edge in draft.edges.values() if edge.domain == 'electrical' for member in edge.members):
            raise ValueError('Circuit connection references an unknown or non-electrical terminal')
    poses, _ = motion(draft, {})
    for key, pose in poses.items(): result["bodies"][key]["pose"] = pose.model_dump(mode="json")
    return parse_layout(result).model_dump(mode="json")


def expand_ref(ref, collection):
    """Project JSON uses key/local-id; layout projections retain explicit collections."""
    parts = ref.split('/')
    return f'{parts[0]}/{collection}/{parts[1]}' if len(parts) == 2 else ref
