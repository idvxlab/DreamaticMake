"""Editable layout v1: projection never depends on simulation validity.

Executable contracts remain unchanged. Each check explicitly reports its coverage.
"""
import json
from math import pi
from types import SimpleNamespace
from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Contract
from element.base.frame import Pose, Vec3, dot
from element.base.quantity import Quantity
from element.interfaces.geometry import Shape, Envelope
from engine.compiler.ir import BoundObject
from element.io.save import content_hash


class Entity(Contract):
    name: str = Field(max_length=200)
    part_id: str | None = None


class Body(Contract):
    entity: str
    pose: Pose = Pose()


class Geometry(Contract):
    body: str
    pose: Pose = Pose()
    shape: Shape
    purpose: Literal["solid", "keepout", "service"] = "solid"
    approximation: Literal["outer", "inner", "unknown"] = "unknown"
    margin_m: float = Field(default=0, ge=0)


class Port(Contract):
    entity: str
    name: str = ""
    domain: Literal["electrical", "material", "information"]
    direction: Literal["in", "out", "bidirectional"] = "bidirectional"
    role: str = ""
    medium: str | None = None
    data_type: str | None = None
    required: bool = False
    body: str | None = None
    pose: Pose | None = None


class Edge(Contract):
    domain: Literal["electrical", "material", "information"]
    kind: str = "connection"
    members: tuple[str, ...] = Field(min_length=2, max_length=128)
    directed: bool = False


class DraftJoint(Contract):
    parent: str
    child: str
    kind: Literal["fixed", "revolute", "continuous", "prismatic"]
    axis: Vec3 | None = None
    parent_anchor: Pose = Pose()
    child_anchor: Pose = Pose()
    lower: float | None = None
    upper: float | None = None
    initial: float | None = None


class DraftTransmission(Contract):
    driver: str
    follower: str
    kind: Literal["rotary_ratio", "screw"] = "rotary_ratio"
    factor: float | None = None
    offset: float = 0


class PathCheck(Contract):
    domain: Literal["electrical", "material", "information"]
    source: str
    target: str


class LayoutDraft(Contract):
    record_kind: Literal["layout_draft"] = "layout_draft"
    layout_version: Literal[1] = 1
    entities: dict[str, Entity] = Field(default_factory=dict, max_length=128)
    bodies: dict[str, Body] = Field(default_factory=dict, max_length=256)
    envelopes: dict[str, Geometry] = Field(default_factory=dict, max_length=512)
    ports: dict[str, Port] = Field(default_factory=dict, max_length=2000)
    edges: dict[str, Edge] = Field(default_factory=dict, max_length=2000)
    joints: dict[str, DraftJoint] = Field(default_factory=dict, max_length=256)
    transmissions: dict[str, DraftTransmission] = Field(default_factory=dict, max_length=256)
    paths: tuple[PathCheck, ...] = Field(default=(), max_length=100)

    @model_validator(mode="after")
    def identities(self):
        reserved = {"__proto__", "constructor", "prototype"}
        all_keys = [key for collection in (self.entities, self.bodies, self.envelopes, self.ports, self.edges, self.joints, self.transmissions) for key in collection]
        if len(all_keys) != len(set(all_keys)):
            raise ValueError("Layout identities must be unique across collections")
        refs = [b.entity for b in self.bodies.values()] + [g.body for g in self.envelopes.values()]
        refs += [p.entity for p in self.ports.values()] + [p.body for p in self.ports.values() if p.body]
        refs += [ref for e in self.edges.values() for ref in e.members]
        refs += [ref for j in self.joints.values() for ref in (j.parent, j.child)]
        refs += [ref for t in self.transmissions.values() for ref in (t.driver, t.follower)]
        refs += [ref for p in self.paths for ref in (p.source, p.target)]
        if any(any(part in reserved for part in ref.split("/")) for ref in refs):
            raise ValueError("Reserved layout reference")
        for collection in (self.entities, self.bodies, self.envelopes, self.ports, self.edges, self.joints, self.transmissions):
            for key in collection:
                if not key or len(key) > 512 or any(c in key for c in "\\\n\r\x00") or any(p in ("__proto__", "constructor", "prototype") for p in key.split("/")):
                    raise ValueError("Invalid layout identity")
        for key in self.bodies:
            if len(key.split("/")) < 2 or key.split("/")[-2] != "bodies":
                raise ValueError("Body identity must end in bodies/<id>")
        return self


def parse_layout(value):
    return LayoutDraft.model_validate_json(json.dumps(value, allow_nan=False))


def issue(code, message, *refs, severity="warning"):
    return {"code": code, "message": message, "object_refs": list(refs),
            "severity": severity, "outcome": "unknown" if severity == "warning" else "fail"}


def project_layout(draft):
    d = draft if isinstance(draft, LayoutDraft) else parse_layout(draft)
    diagnostics = []
    bindings = {key: [b for b, body in d.bodies.items() if body.entity == key] for key in d.entities}
    for key, body in d.bodies.items():
        bindings[key] = [key]
        if body.entity not in d.entities:
            diagnostics.append(issue("layout.entity", "Body owner is unresolved", key, body.entity))
    for key, port in d.ports.items():
        bindings[key] = [port.body] if port.body in d.bodies else bindings.get(port.entity, [])
    envelopes = []
    for key, env in d.envelopes.items():
        bindings[key] = [env.body] if env.body in d.bodies else []
        if env.body not in d.bodies:
            diagnostics.append(issue("layout.body", "Geometry body is unresolved", key, env.body))
            continue
        envelopes.append({"entity_ref": key, "body_ref": env.body,
                          **env.model_dump(mode="json", exclude={"body"})})
    graphs = {}
    for name, domains in (("circuit", {"electrical"}), ("flow", {"material", "information"})):
        nodes = {key: {"id": key, "label": entity.name, "refs": [key], "missing": False} for key, entity in d.entities.items()}
        edges = []
        ports = {key: p.model_dump(mode="json") for key, p in d.ports.items() if p.domain in domains}
        for key, edge in d.edges.items():
            if edge.domain not in domains:
                continue
            members = []
            for ref in edge.members:
                port = d.ports.get(ref)
                entity = port.entity if port else ref
                if entity not in nodes:
                    nodes[entity] = {"id": entity, "label": entity, "refs": [ref], "missing": True}
                members.append({"node": entity, "port": ref})
            bindings[key] = sorted({b for ref in edge.members for b in bindings.get(ref, [])})
            edges.append({"id": key, **edge.model_dump(mode="json"), "endpoints": members})
        graphs[name] = {"nodes": list(nodes.values()), "edges": edges, "ports": ports}
    snapshot = content_hash(d)
    bodies = [{"entity_ref": key, "world_pose": body.pose.model_dump(mode="json")} for key, body in d.bodies.items()]
    for key in d.bodies:
        if not any(e.body == key for e in d.envelopes.values()):
            envelopes.append({"entity_ref": f"{key}/__placeholder", "body_ref": key, "pose": Pose().model_dump(mode="json"),
                "shape": {"kind": "box", "size_m": [.015, .015, .015]}, "purpose": "service", "approximation": "unknown", "margin_m": 0})
            diagnostics.append(issue("layout.placeholder", "Display-only placeholder; geometry is not modeled", key))
    # Display-only placeholders are never sent to collision checks.
    for index, (key, entity) in enumerate(d.entities.items()):
        if not bindings[key]:
            body = f"{key}/bodies/__placeholder"
            bindings[key] = [body]
            bodies.append({"entity_ref": body, "world_pose": Pose(translation_m=(index * .06, -.06, 0.)).model_dump(mode="json")})
            envelopes.append({"entity_ref": f"{key}/envelopes/__placeholder", "body_ref": body, "pose": Pose().model_dump(mode="json"),
                "shape": {"kind": "box", "size_m": [.015, .015, .015]}, "purpose": "service", "approximation": "unknown", "margin_m": 0})
            diagnostics.append(issue("layout.placeholder", "Display-only placeholder; geometry is not modeled", key))
    for key, port in d.ports.items():
        bindings[key] = [port.body] if port.body in d.bodies else bindings.get(port.entity, [])
    for key, edge in d.edges.items():
        bindings[key] = sorted({b for ref in edge.members for b in bindings.get(ref, [])})
    return {"snapshot_id": snapshot, "draft": d.model_dump(mode="json"), "diagnostics": diagnostics, "bindings": bindings,
            "scene": {"snapshot_id": snapshot,
                      "bodies": bodies,
                      "envelopes": envelopes,
                      "joints": [{"entity_ref": key, **j.model_dump(mode="json")} for key, j in d.joints.items()],
                      "visual_assets": [], "collisions": []}, **graphs}


def connectivity(d):
    diagnostics, used, graphs = [], set(), {k: {} for k in ("electrical", "material", "information")}
    membership = {}
    for key, edge in d.edges.items():
        valid = True
        ports = [d.ports.get(ref) for ref in edge.members]
        for ref, port in zip(edge.members, ports):
            if port is None:
                diagnostics.append(issue("connection.missing", "Unresolved endpoint", key, ref, severity="error")); valid = False
            elif port.domain != edge.domain:
                diagnostics.append(issue("connection.domain", "Endpoint domain differs", key, ref, severity="error")); valid = False
            elif port.entity not in d.entities:
                diagnostics.append(issue("connection.entity", "Endpoint owner is unresolved", key, ref, severity="error")); valid = False
        if not valid:
            continue
        if edge.domain == "electrical" and edge.kind != "internal":
            for ref in edge.members:
                if ref in membership and membership[ref] != key:
                    diagnostics.append(issue("connection.multiple_nets", "Terminal assigned to multiple nets", ref, key, membership[ref], severity="error"))
                membership[ref] = key
            roles = {p.role for p in ports if p.role}
            if ("ground" in roles and roles - {"ground", "passive"}) or (roles & {"power_in", "power_out"} and roles & {"input", "output", "bidirectional"}):
                diagnostics.append(issue("connection.roles", "Incompatible terminal roles", key, severity="error")); valid = False
            if "power_in" in roles and "power_out" not in roles:
                diagnostics.append(issue("connection.source", "Power net has no declared source (internal paths are not inferred)", key))
        if edge.domain != "electrical":
            values = {p.medium if edge.domain == "material" else p.data_type for p in ports} - {None, ""}
            if len(values) > 1:
                diagnostics.append(issue("connection.type", "Incompatible medium or data type", key, severity="error")); valid = False
            if edge.directed and (ports[0].direction == "in" or any(p.direction == "out" for p in ports[1:])):
                diagnostics.append(issue("connection.direction", "Connection direction conflicts with ports", key, severity="error")); valid = False
        if not valid:
            continue
        used.update(edge.members)
        graph = graphs[edge.domain]
        for a in edge.members:
            graph.setdefault(a, set())
        if edge.directed:
            graph[edge.members[0]].update(edge.members[1:])
        else:
            for a in edge.members:
                graph[a].update(b for b in edge.members if a != b)
    for key, port in d.ports.items():
        if port.required and key not in used:
            diagnostics.append(issue("connection.required", "Required port is unconnected", key, severity="error"))
    paths = []
    for path in d.paths:
        seen, pending = set(), [path.source]
        while pending:
            item = pending.pop()
            if item not in seen:
                seen.add(item); pending.extend(graphs[path.domain].get(item, set()) - seen)
        found = path.source in d.ports and path.target in d.ports and path.target in seen
        paths.append({**path.model_dump(), "connected": found})
        if not found:
            diagnostics.append(issue("connection.path", "Declared path is absent; internal conduction is not inferred", path.source, path.target, severity="error"))
    return {"kind": "connectivity", "diagnostics": diagnostics, "paths": paths,
            "coverage": ["Declared topology only; no electrical conduction, flow or protocol simulation"],
            "status": "issues" if diagnostics else "completed"}


def motion(d, inputs):
    """Validate and move independent mechanisms. Invalid chains keep layout poses."""
    from element.interfaces.motion import Joint
    from element.base.reference import ObjectRef
    from engine.compiler.ir import BoundJoint, BoundTransmission
    from engine.simulator.kinematics import forward_kinematics, apply_transmissions
    poses = {k: b.pose for k, b in d.bodies.items()}
    positions, diagnostics, accepted, examined = {}, [], [], set()
    adjacency = {b: set() for b in d.bodies}
    for j in d.joints.values():
        if j.parent in adjacency and j.child in adjacency:
            adjacency[j.parent].add(j.child); adjacency[j.child].add(j.parent)
    # Transmission-coupled trees form one preview mechanism too.
    for tr in d.transmissions.values():
        a, b = d.joints.get(tr.driver), d.joints.get(tr.follower)
        if a and b and a.child in adjacency and b.child in adjacency:
            adjacency[a.child].add(b.child); adjacency[b.child].add(a.child)
    groups, seen = [], set()
    for body in d.bodies:
        if body in seen: continue
        group, pending = set(), [body]
        while pending:
            item = pending.pop()
            if item in group: continue
            group.add(item); pending.extend(adjacency[item] - group)
        seen.update(group); groups.append(group)
    for group in groups:
        selected = {k: j for k, j in d.joints.items() if j.parent in group or j.child in group}
        examined.update(selected)
        if not selected: continue
        try:
            bound, children, values = {}, set(), {}
            for key, j in selected.items():
                if j.parent not in group or j.child not in group or j.child in children or j.parent == j.child:
                    raise ValueError("Unresolved or conflicting joint parents")
                children.add(j.child)
                unit = "m" if j.kind == "prismatic" else "rad"
                spec = {"kind": j.kind, "parent_body": {"collection": "bodies", "object_id": "p"}, "child_body": {"collection": "bodies", "object_id": "c"},
                        "parent_anchor": j.parent_anchor.model_dump(mode="json"), "child_anchor": j.child_anchor.model_dump(mode="json")}
                if j.kind != "fixed":
                    if j.initial is None: raise ValueError("Joint initial position is missing")
                    spec.update(axis=j.axis, initial_position={"value": j.initial, "unit": unit})
                    if j.kind != "continuous":
                        if j.lower is None or j.upper is None: raise ValueError("Joint limits are missing")
                        spec["position_limit"] = {"min": {"value": j.lower, "unit": unit}, "max": {"value": j.upper, "unit": unit}}
                    values[key] = inputs.get(key, j.initial)
                    if isinstance(values[key], bool) or not isinstance(values[key], (int, float)):
                        raise ValueError("Joint input must be numeric")
                else: values[key] = 0.0
                bound[key] = BoundJoint(key, j.parent, j.child, Joint.model_validate_json(json.dumps(spec, allow_nan=False)))
            roots = group - children
            order, visited, pending = [], set(roots), dict(bound)
            while pending:
                ready = sorted(k for k, j in pending.items() if j.parent in visited)
                if not ready: raise ValueError("Closed kinematic loops are unsupported")
                for key in ready:
                    visited.add(pending[key].child); order.append(key); del pending[key]
            transmissions, followers = [], set()
            remaining = {k: tr for k, tr in d.transmissions.items() if tr.driver in selected or tr.follower in selected}
            while remaining:
                ready = [k for k, tr in remaining.items() if tr.driver not in {x.follower for x in remaining.values()}]
                if not ready: raise ValueError("Transmission cycle")
                for key in sorted(ready):
                    tr = remaining.pop(key)
                    if tr.driver not in bound or tr.follower not in bound or tr.follower in followers or not tr.factor:
                        raise ValueError("Incomplete/conflicting transmission")
                    if tr.follower in inputs:
                        raise ValueError("Transmission follower is driven by its driver: " + tr.follower)
                    driver, follower = selected[tr.driver], selected[tr.follower]
                    if driver.kind not in ("revolute", "continuous") or (follower.kind != "prismatic" if tr.kind == "screw" else follower.kind not in ("revolute", "continuous")):
                        raise ValueError("Transmission joint types differ")
                    followers.add(tr.follower)
                    spec = SimpleNamespace(kind=tr.kind, ratio=tr.factor, lead_m_per_rev=tr.factor,
                                           offset=Quantity(value=tr.offset, unit="m" if tr.kind == "screw" else "rad"))
                    transmissions.append(BoundTransmission(key, tr.driver, tr.follower, spec))
            ir = SimpleNamespace(joints=bound, joint_order=order, transmissions=transmissions)
            apply_transmissions(ir, values)
            for key, value in values.items():
                j = selected[key]
                if j.kind != "fixed" and ((j.lower is not None and value < j.lower) or (j.upper is not None and value > j.upper)):
                    raise ValueError("Joint position exceeds limits: " + key)
            poses.update(forward_kinematics(ir, values, {k: poses[k] for k in roots}))
            positions.update(values); accepted.extend(selected)
        except (ValueError, KeyError, TypeError) as exc:
            diagnostics.append(issue("motion.unavailable", str(exc), *selected))
    for key in inputs:
        if key not in d.joints: diagnostics.append(issue("motion.input", "Unknown joint input", key))
    for key in set(d.joints) - examined:
        diagnostics.append(issue("motion.unavailable", "Joint bodies are unresolved", key))
    for key, tr in d.transmissions.items():
        if tr.driver not in examined and tr.follower not in examined:
            diagnostics.append(issue("motion.unavailable", "Transmission joints are unresolved", key))
    return poses, {"kind": "motion", "diagnostics": diagnostics, "joint_positions": positions, "accepted": accepted,
                   "status": "issues" if diagnostics else "completed"}


def collision(d, poses, resolver=None):
    from engine.simulator.collision import query_collisions
    from element.io.mesh import resolve_stl
    objects, diagnostics, skipped = {}, [], []
    for key, e in d.envelopes.items():
        if e.body not in poses or e.shape.kind == "convex_asset":
            skipped.append(key); continue
        try:
            if e.shape.kind == "triangle_mesh": resolve_stl(e.shape, resolver)
            scope = tuple(e.body.split("/")[:-2])
            spec = Envelope.model_validate_json(json.dumps({**e.model_dump(mode="json", exclude={"body"}), "body_ref": e.body.split("/")[-1]}))
            objects[key] = BoundObject(key, scope, spec)
        except (ValueError, ImportError, OSError) as exc:
            skipped.append(key); diagnostics.append(issue("collision.asset", str(exc), key))
    ir = SimpleNamespace(collection=lambda name: objects if name == "envelopes" else {})
    pairs = ()
    try:
        if any(o.spec.shape.kind == "triangle_mesh" for o in objects.values()):
            from engine.simulator.mesh_collision import MeshCollisionWorld
            pairs = MeshCollisionWorld(ir, resolver).query(poses)
        else:
            pairs = query_collisions(ir, poses, conservative=True)
    except (ValueError, ImportError, OSError) as exc:
        skipped.extend(objects); objects = {}; diagnostics.append(issue("collision.unavailable", str(exc)))
    covered_bodies = {"/".join((*o.scope, "bodies", o.spec.body_ref)) for o in objects.values() if o.spec.purpose == "solid"}
    missing = sorted(set(d.bodies) - covered_bodies) + [key for key in d.entities if not any(body.entity == key for body in d.bodies.values())]
    for a, b in pairs: diagnostics.append(issue("collision.overlap", "Declared envelopes overlap", a, b, severity="error"))
    return {"kind": "collision", "pairs": pairs, "diagnostics": diagnostics, "checked": list(objects),
            "skipped": skipped, "missing_bodies": missing,
            "coverage": ["Discrete envelope overlaps; cylinders/capsules use conservative boxes without the mesh backend"],
            "status": "issues" if pairs else "partial" if skipped or missing else "completed"}


def dispatch_layout(method, data, resolver=None):
    if method == "layout_import": return {"draft": import_layout(data["source"], data.get("scenario"))}
    d = parse_layout(data["draft"])
    payload = project_layout(d)
    if method == "layout_project": return payload
    if method == "layout_connectivity": payload["check"] = connectivity(d)
    elif method in ("layout_motion", "layout_collision"):
        inputs = data.get("joint_inputs", {})
        if inputs:
            poses, report = motion(d, inputs)
            payload["motion"] = report
        else:
            poses = {k: b.pose for k, b in d.bodies.items()}
            if method == "layout_motion": poses, payload["motion"] = motion(d, inputs)
        for body in payload["scene"]["bodies"]:
            if body["entity_ref"] in poses: body["world_pose"] = poses[body["entity_ref"]].model_dump(mode="json")
        if method == "layout_collision":
            payload["check"] = collision(d, poses, resolver)
            if payload.get("motion", {}).get("status") == "issues":
                payload["check"]["coverage"].append("Invalid mechanisms retain layout poses; requested motion was not fully checked")
                if payload["check"]["status"] == "completed": payload["check"]["status"] = "partial"
            payload["scene"]["collisions"] = payload["check"]["pairs"]
        payload["pose_id"] = content_hash({k: p.model_dump(mode="json") for k, p in poses.items()})
    else: raise ValueError("Unknown layout operation")
    return payload


def import_layout(source, scenario=None):
    """Import strict legacy definitions without compiling electrical/kinematic semantics."""
    if source.get("record_kind") == "layout_project":
        from engine.layout_project import compose_project
        return compose_project(source)
    from engine.io.load import loads_model
    from engine.compiler.resolve import resolve
    from engine.adapters.assembly import assemble_components
    if source.get("record_kind") == "layout_draft": return parse_layout(source).model_dump(mode="json")
    if isinstance(source.get("components"), dict):
        from engine.io.design import AssemblyDesign
        design = AssemblyDesign.model_validate_json(json.dumps(source))
        bundle = assemble_components(id=design.id, name=design.name, components=design.components, connections=design.connections)
        from engine.schema.assembly import AssemblyDefinition, ModelBundle
        from element.base.identity import DefinitionRef
        assembly = AssemblyDefinition.model_validate_json(json.dumps({**bundle.assemblies[0].model_dump(mode="json"),
            "joints": {k: v.model_dump(mode="json") for k, v in design.joints.items()},
            "transmissions": {k: v.model_dump(mode="json") for k, v in design.transmissions.items()}}))
        bundle = ModelBundle(components=bundle.components, assemblies=(assembly,), root=DefinitionRef(id=assembly.id, revision=assembly.revision, content_hash=content_hash(assembly)))
    else:
        bundle = loads_model(json.dumps(source))
        from element.categories.base import ComponentDesign
        from element.schema.library import ElementDefinition
        if isinstance(bundle, (ComponentDesign, ElementDefinition)):
            from engine.adapters.elements import to_bundle
            bundle = to_bundle(bundle)
    r = resolve(bundle)
    result = LayoutDraft().model_dump(mode="json")
    roots = {"/".join((*x["body_ref"].get("instance_path", []), "bodies", x["body_ref"]["object_id"])): x.get("world_pose", Pose().model_dump(mode="json")) for x in (scenario or {}).get("roots", [])}
    def ref(x, scope): return r.ref(x, scope)
    for index, (scope, c) in enumerate(r.components.items()):
        owner = "/".join(scope) or c.id
        result["entities"][owner] = {"name": c.name}
        for key, obj in r.objects.items():
            if obj.scope != scope: continue
            collection = key.split("/")[-2]; spec = obj.spec
            if collection == "bodies": result["bodies"][key] = {"entity": owner, "pose": roots.get(key, Pose(translation_m=(index * .06, 0., 0.)).model_dump(mode="json"))}
            elif collection == "envelopes": result["envelopes"][key] = {**spec.model_dump(mode="json", exclude={"body_ref", "evidence_refs"}), "body": "/".join((*scope, "bodies", spec.body_ref))}
            elif collection in ("terminals", "material_ports", "sensors", "behaviors", "effects", "interfaces"):
                domain = "electrical" if collection == "terminals" else "material" if collection == "material_ports" else "information"
                body = getattr(spec, "body_ref", None)
                result["ports"][key] = {"entity": owner, "name": getattr(spec, "label", "") or key.split("/")[-1], "domain": domain,
                    "body": "/".join((*scope, "bodies", body)) if body else None,
                    "pose": spec.pose.model_dump(mode="json") if getattr(spec, "pose", None) else None,
                    "direction": getattr(spec, "direction", "bidirectional"), "role": getattr(spec, "electrical_role", ""),
                    "medium": getattr(spec, "medium_ref", None)}
            if collection == "material_paths":
                result["edges"][key] = {"domain": "material", "kind": "internal", "directed": True, "members": ["/".join((*scope, "material_ports", spec.inlet_port)), "/".join((*scope, "material_ports", spec.outlet_port))]}
            if collection == "behaviors":
                for name, binding in spec.inputs.items():
                    if binding.ref:
                        target = ref(binding.ref, scope)
                        # Information binding to a physical terminal uses an explicit information endpoint.
                        if binding.ref.collection == "terminals":
                            alias = target + "/signal"
                            target_obj = r.objects.get(target)
                            target_owner = ("/".join(target_obj.scope) or r.components[target_obj.scope].id) if target_obj else owner
                            result["ports"][alias] = {"entity": target_owner, "name": name, "domain": "information"}
                            target = alias
                        result["edges"][key + "/" + name] = {"domain": "information", "members": [target, key], "directed": True}
            if collection == "effects":
                result["edges"][key + "/input"] = {"domain": "information", "members": ["/".join((*scope, "behaviors", spec.behavior_output_ref.behavior_id)), key], "directed": True}
    for key, obj in r.objects.items():
        if key.split("/")[-2] != "joints": continue
        j = obj.spec
        result["joints"][key] = {"parent": ref(j.parent_body, obj.scope), "child": ref(j.child_body, obj.scope), "kind": j.kind,
            "axis": j.axis, "parent_anchor": j.parent_anchor.model_dump(mode="json"), "child_anchor": j.child_anchor.model_dump(mode="json"),
            "initial": j.initial_position.si_value if j.initial_position else None,
            "lower": j.position_limit.min.si_value if j.position_limit else None, "upper": j.position_limit.max.si_value if j.position_limit else None}
    for scope, definition in [*r.components.items(), *r.assemblies.items()]:
        transmissions = definition.physical.motion.transmissions if hasattr(definition, "physical") else definition.transmissions
        for key, tr in transmissions.items():
            result["transmissions"]["/".join((*scope, "transmissions", key))] = {"driver": ref(tr.driver_joint, scope), "follower": ref(tr.follower_joint, scope), "kind": tr.kind,
                "factor": tr.ratio if tr.kind == "rotary_ratio" else tr.lead_m_per_rev, "offset": tr.offset.si_value}
    for scope, a in r.assemblies.items():
        for key, net in a.connections.electrical_nets.items(): result["edges"]["/".join((*scope, "nets", key))] = {"domain": "electrical", "kind": net.kind, "members": [ref(x, scope) for x in net.members]}
        for key, edge in a.connections.material.items(): result["edges"]["/".join((*scope, "material_connections", key))] = {"domain": "material", "members": [ref(edge.a, scope), ref(edge.b, scope)]}
        for key, mount in a.connections.mechanical.items():
            if mount.constraint_mode != "fixed": continue
            pa, pb = r.objects[ref(mount.a, scope)], r.objects[ref(mount.b, scope)]
            result["joints"]["/".join((*scope, "mounts", key))] = {"kind": "fixed",
                "parent": "/".join((*pa.scope, "bodies", pa.spec.body_ref)), "child": "/".join((*pb.scope, "bodies", pb.spec.body_ref)),
                "parent_anchor": pa.spec.pose.compose(mount.alignment).model_dump(mode="json"), "child_anchor": pb.spec.pose.model_dump(mode="json")}
    d = parse_layout(result)
    poses, _ = motion(d, {})
    for key, pose in poses.items(): result["bodies"][key]["pose"] = pose.model_dump(mode="json")
    return parse_layout(result).model_dump(mode="json")
