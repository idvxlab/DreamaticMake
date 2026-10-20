"""Cross-object validation, kept separate from schema parsing."""

from pydantic import BaseModel
from engine.base.diagnostic import Diagnostic
from engine.base.reference import ObjectRef
from engine.base.quantity import Parameter
from engine.interface.effects import MotionEffect
from engine.compiler.resolve import error


def warning(code, message, *refs, outcome="unknown"):
    return Diagnostic(code=code, message=message, object_refs=tuple(refs), severity="warning", outcome=outcome)


def walk(value):
    yield value
    if isinstance(value, BaseModel):
        for name in type(value).model_fields:
            yield from walk(getattr(value, name))
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, (tuple, list)):
        for item in value:
            yield from walk(item)


def validate_resolved(r):
    diagnostics = []

    def need(ref, scope, owner):
        key = r.ref(ref, scope)
        if key not in r.objects:
            diagnostics.append(error("reference.missing", "Referenced object does not exist", owner, key))
            return None
        return r.objects[key].spec

    def local(collection, name, scope, owner):
        return need(ObjectRef(collection=collection, object_id=name), scope, owner)

    for scope, definition in [*r.components.items(), *r.assemblies.items()]:
        owner = "/".join(scope) or definition.id
        # Instance refs inside child definitions are checked in their own scope.
        for item in walk(definition):
            if isinstance(item, Parameter) and item.status == "unknown":
                diagnostics.append(warning("parameter.unknown", "A parameter is explicitly unknown", owner))
        for key, evidence in definition.evidence.items():
            if evidence.source_ref and evidence.source_ref not in definition.sources:
                diagnostics.append(error("evidence.source", "Evidence source is missing", owner, key))
        for item in walk(definition):
            if isinstance(item, BaseModel) and "evidence_refs" in type(item).model_fields:
                for ev in item.evidence_refs:
                    if ev not in definition.evidence:
                        diagnostics.append(error("evidence.missing", "Evidence reference is missing", owner, ev))
        for p in definition.principles.values():
            for b in p.behavior_refs:
                local("behaviors", b, scope, owner)
        for realization in definition.realizations.values():
            if realization.function_ref not in definition.functions or any(p not in definition.principles for p in realization.principle_refs):
                diagnostics.append(error("realization.missing", "Function or principle is missing", owner))
            for ref in realization.object_refs:
                need(ref, scope, owner)

    for key, obj in r.objects.items():
        spec, scope = obj.spec, obj.scope
        for item in walk(spec):
            if isinstance(item, ObjectRef):
                need(item, scope, key)
        body_ref = getattr(spec, "body_ref", None)
        if body_ref:
            local("bodies", body_ref, scope, key)
        location = getattr(spec, "location", None)
        if location:
            local("bodies", location.body_ref, scope, key)
        for field in ("reference_terminal",):
            name = getattr(spec, field, None)
            if name:
                local("terminals", name, scope, key)
        for name in getattr(spec, "supply_terminals", ()):
            terminal = local("terminals", name, scope, key)
            if terminal and terminal.electrical_role != "power_in":
                diagnostics.append(error("supply.role", "Supply bindings require power inputs", key))
        if key.split("/")[-2] == "behaviors":
            for name in spec.output_terminals:
                terminal = local("terminals", name, scope, key)
                if terminal and (terminal.drive == "none" or spec.output_type.kind != "digital"):
                    diagnostics.append(error("behavior.output", "Network outputs require a digital signal and driving terminal", key))
        if key.split("/")[-2] == "interfaces":
            behavior = local("behaviors", spec.behavior_ref, scope, key)
            for name in spec.terminal_bindings.values():
                local("terminals", name, scope, key)
            # Protocol adapters are not silently synthesized from endpoint names.
            diagnostics.append(warning("interface.contract_only", "Protocol contract is descriptive; use explicit behavior bindings", key))
            if behavior and set(spec.supply_terminals) != set(behavior.supply_terminals):
                diagnostics.append(error("interface.supply", "Interface and behavior supply bindings must agree", key))
        if key.split("/")[-2] == "effects":
            behavior = local("behaviors", spec.behavior_output_ref.behavior_id, scope, key)
            if spec.behavior_output_ref.output != "value":
                diagnostics.append(error("effect.output", "First release exposes only the value output", key))
            if behavior and spec.value_type != behavior.output_type:
                diagnostics.append(error("effect.type", "Effect and behavior output types differ", key))
            if isinstance(spec, MotionEffect):
                joint = need(spec.target_joint, scope, key)
                if joint and spec.target_joint.collection == "joints":
                    from engine.base.quantity import UNITS
                    dimension = joint.dimension if spec.mode == "position" else ("speed" if joint.dimension == "length" else "angular_speed")
                    if spec.value_type.kind != "scalar" or UNITS[spec.value_type.unit][0] != dimension or joint.drive_mode != spec.mode:
                        diagnostics.append(error("effect.motion", "Motion effect type or drive mode is incompatible", key))
                else:
                    diagnostics.append(error("effect.target", "Motion effect requires a joint", key))
            elif spec.model_ref:
                diagnostics.append(warning("effect.model_unavailable", "Effect model is recorded but not executed by this release", key, outcome="unsupported"))
        if key.split("/")[-2] == "material_paths":
            inlet = local("material_ports", spec.inlet_port, scope, key)
            outlet = local("material_ports", spec.outlet_port, scope, key)
            if inlet and outlet and (inlet.medium_ref != outlet.medium_ref or inlet.medium_kind != outlet.medium_kind or inlet.direction == "out" or outlet.direction == "in"):
                diagnostics.append(error("material.path", "Incompatible internal material path", key))
            if spec.drive_effect_ref:
                local("effects", spec.drive_effect_ref, scope, key)
            diagnostics.append(warning("material.topology_only", "Material path is represented; no flow solver was executed", key, outcome="unsupported"))

    for scope, c in r.components.items():
        owner = "/".join(scope) or c.id
        geometry = c.physical.geometry
        if geometry.bodies and (geometry.root_body is None or geometry.root_body not in geometry.bodies):
            diagnostics.append(error("geometry.root", "Geometry requires an existing root body", owner))
        if geometry.root_body and not geometry.bodies:
            diagnostics.append(error("geometry.root", "Root body is missing", owner))
        for visual in geometry.visual_assets.values():
            local("bodies", visual.body_ref, scope, owner)
        for connector in c.electronic.electrical.connectors.values():
            local("bodies", connector.body_ref, scope, owner)
            for name in connector.pin_map.values():
                local("terminals", name, scope, owner)
        for t in c.physical.motion.transmissions.values():
            need(t.driver_joint, scope, owner)
            need(t.follower_joint, scope, owner)

    for scope, a in r.assemblies.items():
        owner = "/".join(scope) or a.id
        for item in walk(a.connections):
            if isinstance(item, ObjectRef):
                need(item, scope, owner)
        for t in a.transmissions.values():
            need(t.driver_joint, scope, owner)
            need(t.follower_joint, scope, owner)
        for connection in a.connections.material.values():
            p = need(connection.a, scope, owner)
            q = need(connection.b, scope, owner)
            if connection.a.collection != "material_ports" or connection.b.collection != "material_ports":
                diagnostics.append(error("material.reference", "Material connections require material ports", owner))
            elif p and q and (p.medium_ref != q.medium_ref or p.medium_kind != q.medium_kind or p.direction == q.direction != "bidirectional"):
                diagnostics.append(error("material.connection", "Incompatible material connection", owner))
            else:
                diagnostics.append(warning("material.fit_unchecked", "Material compatibility is checked; connector fit and pressure loss are not solved", owner))
        for connection in a.connections.mechanical.values():
            p = need(connection.a, scope, owner)
            q = need(connection.b, scope, owner)
            if p and q and ((p.allowed_mates and q.kind not in p.allowed_mates) or (q.allowed_mates and p.kind not in q.allowed_mates)):
                diagnostics.append(error("mechanical.mate", "Mechanical port kinds cannot mate", owner))
            if p and q and p.thread and q.thread and p.thread != q.thread:
                diagnostics.append(error("mechanical.thread", "Thread declarations differ", owner))
    return diagnostics
