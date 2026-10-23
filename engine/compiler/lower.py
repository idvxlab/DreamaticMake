from types import MappingProxyType
from element.base.diagnostic import ModelError
from element.base.reference import ObjectRef
from element.interfaces.motion import Joint
from element.interfaces.effects import MotionEffect
from element.io.save import canonical_json, content_hash
from engine.schema.assembly import ModelBundle
from engine.compiler.ir import SimulationIR, BoundJoint, BoundNet, BoundTransmission
from engine.compiler.resolve import resolve, error
from engine.compiler.validate import validate_resolved, warning
from element.categories.base import ComponentDesign


def compile_model(bundle: ModelBundle | ComponentDesign) -> SimulationIR:
    from element.schema.library import ElementDefinition
    if isinstance(bundle, (ComponentDesign, ElementDefinition)):
        from engine.adapters.elements import to_bundle
        bundle = to_bundle(bundle)
    # Revalidate callers that used unchecked Pydantic model_copy/model_construct.
    bundle = ModelBundle.model_validate_json(canonical_json(bundle))
    r = resolve(bundle)
    diagnostics = validate_resolved(r)
    for scope, component in r.components.items():
        if "_component_design" in component.sources:
            diagnostics.append(warning("component.design_contract",
                "Category metadata is a design contract. Only lowered geometry, joints, signals and topology execute; "
                "no firmware, pixel/audio rendering, energy release or physical performance is verified.",
                "/".join(scope) or component.id))
        category = component.functions.get("_category")
        description = component.functions.get("_description")
        if category and category.capability == "component.circuit_element":
            diagnostics.append(warning("circuit.analysis_unavailable",
                "Circuit element geometry, pins and ratings are described; no analog circuit solver or continuity through the element was executed.",
                "/".join(scope) or component.id, outcome="unsupported"))
        if description and description.capability in ("description.sensor.camera", "description.sensor.microphone"):
            diagnostics.append(warning("sensor.stream_unavailable",
                "Camera/audio stream specifications are descriptive; no image or audio stream was sampled.",
                "/".join(scope) or component.id, outcome="unsupported"))
    if any(d.severity == "error" for d in diagnostics):
        raise ModelError(diagnostics)
    joints = {}
    for key, obj in r.objects.items():
        if isinstance(obj.spec, Joint):
            joints[key] = BoundJoint(key, r.ref(obj.spec.parent_body, obj.scope), r.ref(obj.spec.child_body, obj.scope), obj.spec)

    for scope, a in r.assemblies.items():
        for name, connection in a.connections.mechanical.items():
            p_obj = r.objects[r.ref(connection.a, scope)]
            q_obj = r.objects[r.ref(connection.b, scope)]
            p, q = p_obj.spec, q_obj.spec
            parent = ObjectRef(collection="bodies", object_id=p.body_ref).key(p_obj.scope)
            child = ObjectRef(collection="bodies", object_id=q.body_ref).key(q_obj.scope)
            key = "/".join((*scope, "mounts", name))
            if connection.constraint_mode == "fixed":
                joint = Joint(kind="fixed", parent_body=ObjectRef(collection="bodies", object_id=p.body_ref),
                              child_body=ObjectRef(collection="bodies", object_id=q.body_ref),
                              parent_anchor=p.pose.compose(connection.alignment), child_anchor=q.pose)
                joints[key] = BoundJoint(key, parent, child, joint)
            elif connection.constraint_mode == "joint":
                bound = joints.get(r.ref(connection.joint_ref, scope))
                if bound is None or {bound.parent, bound.child} != {parent, child}:
                    diagnostics.append(error("mount.joint", "Mount joint must connect the same bodies", key))
            else:
                diagnostics.append(warning("contact.unsupported", "Contact is recorded without contact response or collision exemptions", key, outcome="unsupported"))
            diagnostics.append(warning("mount.fit", "Mount alignment is modeled; dimensional fit and tolerances are not solved", key))

    bodies = {key for key in r.objects if key.split("/")[-2] == "bodies"}
    child_joints = {}
    for key, joint in joints.items():
        if joint.child in child_joints or joint.parent == joint.child:
            diagnostics.append(error("joint.overconstrained", "A body has multiple parents or a self joint", key))
        child_joints[joint.child] = key
    roots = tuple(sorted(bodies - child_joints.keys()))
    visited = set(roots)
    pending = dict(joints)
    order = []
    while pending:
        ready = sorted(k for k, j in pending.items() if j.parent in visited)
        if not ready:
            diagnostics.append(error("joint.cycle", "Closed kinematic loops are not supported"))
            break
        for key in ready:
            visited.add(pending[key].child)
            order.append(key)
            del pending[key]

    transmissions = []
    for scope, definition in [*r.components.items(), *r.assemblies.items()]:
        items = definition.physical.motion.transmissions if hasattr(definition, "physical") else definition.transmissions
        for name, spec in items.items():
            key = "/".join((*scope, "transmissions", name))
            driver, follower = r.ref(spec.driver_joint, scope), r.ref(spec.follower_joint, scope)
            d, f = joints[driver].spec, joints[follower].spec
            expected = "prismatic" if spec.kind == "screw" else None
            if d.kind not in ("revolute", "continuous") or (f.kind != expected if expected else f.kind not in ("revolute", "continuous")):
                diagnostics.append(error("transmission.type", "Transmission joint dimensions are incompatible", key))
            if f.drive_mode != "passive":
                diagnostics.append(error("transmission.driver", "Follower joint must be passive", key))
            transmissions.append(BoundTransmission(key, driver, follower, spec))
    followers = [t.follower for t in transmissions]
    if len(set(followers)) != len(followers):
        diagnostics.append(error("transmission.multiple", "A joint has more than one transmission driver"))
    sorted_transmissions = []
    remaining = list(transmissions)
    while remaining:
        pending_followers = {t.follower for t in remaining}
        ready = sorted((t for t in remaining if t.driver not in pending_followers), key=lambda t: t.key)
        if not ready:
            diagnostics.append(error("transmission.cycle", "Cyclic transmission chain"))
            break
        sorted_transmissions.extend(ready)
        remaining = [t for t in remaining if t not in ready]

    nets, terminal_nets = {}, {}
    for scope, assembly in r.assemblies.items():
        for name, spec in assembly.connections.electrical_nets.items():
            key = "/".join((*scope, "nets", name))
            members = tuple(r.ref(ref, scope) for ref in spec.members)
            if len(set(members)) != len(members):
                diagnostics.append(error("net.alias_duplicate", "Aliases identify the same terminal more than once", key))
            for member in members:
                if member in terminal_nets:
                    diagnostics.append(error("net.multiple", "Terminal belongs to multiple nets; merge the nets explicitly", member))
                terminal_nets[member] = key
            nets[key] = BoundNet(key, members, spec)
            if spec.reference_net and spec.reference_net not in assembly.connections.electrical_nets:
                diagnostics.append(error("net.reference", "Reference net does not exist", key))
            roles = {r.objects[m].spec.electrical_role for m in members}
            if (spec.kind == "ground" and roles != {"ground"}) or (spec.kind == "power" and not roles <= {"power_in", "power_out", "passive"}):
                diagnostics.append(error("net.roles", "Net kind and terminal roles conflict", key))
            if spec.kind == "signal" and roles & {"power_in", "power_out", "ground"}:
                diagnostics.append(error("net.roles", "Signal net contains power terminals", key))
            if spec.kind == "power":
                sources = [r.objects[m].spec for m in members if r.objects[m].spec.electrical_role == "power_out"]
                if len(sources) > 1:
                    diagnostics.append(error("power.multiple_sources", "Parallel power sources require an explicit sharing model", key))
                if len(sources) == 1 and sources[0].nominal_voltage:
                    voltage = sources[0].nominal_voltage
                    for m in members:
                        limits = r.objects[m].spec.voltage_limits
                        if limits and not limits.contains(voltage):
                            diagnostics.append(error("power.voltage", "Source voltage violates a terminal rating", key, m))

    driven_joints, driven_terminals = set(followers), set()
    for key, obj in r.objects.items():
        if isinstance(obj.spec, MotionEffect):
            target = r.ref(obj.spec.target_joint, obj.scope)
            if target in driven_joints:
                diagnostics.append(error("driver.multiple", "Multiple drivers target one joint", key, target))
            driven_joints.add(target)
        if key.split("/")[-2] == "behaviors":
            for terminal in obj.spec.output_terminals:
                target = ObjectRef(collection="terminals", object_id=terminal).key(obj.scope)
                if target in driven_terminals:
                    diagnostics.append(error("driver.multiple", "Multiple behaviors drive the same terminal", target))
                driven_terminals.add(target)

    if any(d.severity == "error" for d in diagnostics):
        raise ModelError(diagnostics)
    freeze = MappingProxyType
    return SimulationIR(content_hash(bundle), canonical_json(bundle), freeze(r.objects), freeze(r.components),
                        freeze(joints), tuple(order), tuple(sorted_transmissions), roots, freeze(nets),
                        freeze(terminal_nets), freeze(r.aliases), freeze(dict(bundle.input_revisions)), tuple(diagnostics))
