"""Occurrence views over pinned element definitions, never persisted copies of elements."""
from hashlib import sha256
import json
from element.base.frame import Pose, scale
from engine.design.contracts import *
from engine.design.io import parse_record

# Local element names and design-layer addresses are intentionally separate namespaces.
TARGETS = {
    'bodies': ('structure', 'bodies'), 'envelopes': ('structure', 'geometry'),
    'mounts': ('structure', 'mounts'), 'joints': ('motion', 'joints'),
    'transmissions': ('motion', 'transmissions'), 'terminals': ('circuit_energy', 'terminals'),
    'energy_ports': ('circuit_energy', 'energy_ports'), 'material_ports': ('flow', 'ports'),
    'information_ports': ('flow', 'ports'), 'material_paths': ('flow', 'edges'),
    'interfaces': ('logic', 'interfaces'), 'behaviors': ('logic', 'units'),
}

def occurrence_ref(instance_ref, collection, object_id):
    """Stable address, independent of array order, display names, and definition revision."""
    kind, target = TARGETS[collection]
    token = sha256(instance_ref.key().encode()).hexdigest()[:24]
    name = 'o_' + sha256(f'{collection}/{object_id}'.encode()).hexdigest()[:24]
    return ObjectRef(record_id=f'element_{token}_{kind}', collection=target, object_id=name)

def binding_key(binding):
    return (binding.instance_ref.key(), binding.local_ref.collection, binding.local_ref.object_id)

def merge(base, delta):
    result = dict(base)
    for key, value in delta.items():
        result[key] = merge(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else value
    return result

def signal_type(signal):
    if signal.kind == 'scalar': return ScalarType(unit=signal.unit)
    if signal.kind == 'boolean': return BooleanType()
    if signal.kind == 'digital': return EnumType(values=('0', '1', 'X', 'Z'))
    if signal.kind == 'event': return EventType(schema_id=signal.protocol or 'event')
    return StreamType(schema_id=signal.protocol or signal.kind)

def expand_elements(resolved):
    """Build effective records and native occurrence objects from the selected definitions."""
    authored = dict(resolved.records)
    claims = {}
    patches = {}
    resolved.element_objects = {}
    resolved.occurrence_refs = {}
    # A source-backed object gives a local object an authored address. References inside
    # the same element must use this address too (otherwise an alias duplicates hardware).
    for record in authored.values():
        for collection in set(TARGETS.values()):
            kind, name = collection
            if record.kind != kind: continue
            for oid, value in getattr(record.data, name).items():
                source = getattr(value, 'source', None)
                if not isinstance(source, ElementBinding): continue
                key = binding_key(source)
                target = ObjectRef(record_id=record.record_id, collection=name, object_id=oid)
                if TARGETS.get(source.local_ref.collection) != (kind, name):
                    resolved.issue('element.source_type', 'Source collection does not match design collection', target)
                    continue
                if key in claims and claims[key] != target:
                    resolved.issue('element.duplicate_source', 'Local object has multiple design declarations', target)
                    continue
                claims[key] = target
                patches[key] = value
    budget = sum(sum(len(v) for v in d.collections().values()) for d in resolved.instance_elements.values())
    if budget + len(resolved.objects) > 10000: raise ValueError('Design object budget exceeded')
    generated = {}
    replacements = {}
    for instance_key, definition in resolved.instance_elements.items():
        instance_ref = ObjectRef(record_id=instance_key.split('/')[0], collection='instances', object_id=instance_key.split('/')[2])
        instance = resolved.objects[instance_key]
        local = definition.collections()
        def ref(collection, name):
            key = (instance_key, collection, name)
            return claims.get(key, occurrence_ref(instance_ref, collection, name))
        def source(collection, name):
            return ElementBinding(instance_ref=instance_ref, local_ref=ElementObjectRef(collection=collection, object_id=name))
        for collection, values in local.items():
            for name, native in values.items():
                key = (instance_key, collection, name)
                resolved.element_objects[key] = native
                if collection in TARGETS: resolved.occurrence_refs[key] = ref(collection, name)
        children = {}
        for joint_name, joint in local['joints'].items():
            patch = patches.get((instance_key, 'joints', joint_name))
            if isinstance(patch, InheritedObject) and set(patch.overrides) == {'initial'}:
                try:
                    raw = joint.model_dump(mode='json')
                    raw['initial_position'] = merge(raw['initial_position'], patch.overrides['initial']) if isinstance(raw['initial_position'], dict) and isinstance(patch.overrides['initial'], dict) else patch.overrides['initial']
                    joint = type(joint).model_validate_json(json.dumps(raw))
                except ValueError:
                    pass  # The effective joint validation below emits the diagnostic.
            child = joint.child_body.object_id
            if child in children:
                resolved.issue('element.body_parents', 'Body has multiple internal joint parents', instance_ref)
            children[child] = joint
        for collection, values in local.items():
            if collection not in TARGETS: continue
            for name, native in values.items():
                key = (instance_key, collection, name)
                src = source(collection, name)
                target = ref(collection, name)
                common = dict(source=src, instance_ref=instance_ref)
                if collection == 'bodies':
                    joint = children.get(name)
                    pose, parent = None, None
                    if joint:
                        parent = ref('bodies', joint.parent_body.object_id)
                        if joint.kind == 'fixed' or joint.initial_position is not None:
                            q = joint.initial_position.si_value if joint.initial_position else 0.0
                            motion = Pose(translation_m=scale(joint.axis, q)) if joint.kind == 'prismatic' else Pose.axis_angle(joint.axis, q) if joint.axis else Pose()
                            pose = joint.parent_anchor.compose(motion).compose(joint.child_anchor.inverse())
                    elif name == definition.model.geometry.root_body:
                        pose = instance.pose
                    value = Body(**common, pose=pose, parent_body=parent, placement='specified' if pose else 'unplaced')
                elif collection == 'envelopes':
                    value = Geometry(source=src, body_ref=ref('bodies', native.body_ref), **native.model_dump(exclude={'body_ref', 'evidence_refs'}))
                elif collection == 'mounts':
                    value = Mount(source=src, body_ref=ref('bodies', native.body_ref), pose=native.pose, interface_kind=native.kind)
                elif collection == 'joints':
                    value = Joint(source=src, parent_body=ref('bodies', native.parent_body.object_id), child_body=ref('bodies', native.child_body.object_id),
                        kind=native.kind, axis=native.axis, parent_anchor=native.parent_anchor, child_anchor=native.child_anchor,
                        lower=native.position_limit.min if native.position_limit else None,
                        upper=native.position_limit.max if native.position_limit else None, initial=native.initial_position)
                elif collection == 'transmissions':
                    value = Transmission(source=src, driver=ref('joints', native.driver_joint.object_id), follower=ref('joints', native.follower_joint.object_id),
                        kind=native.kind, factor=Quantity(value=native.ratio if native.kind == 'rotary_ratio' else native.lead_m_per_rev,
                        unit='1' if native.kind == 'rotary_ratio' else 'm'), offset=native.offset)
                elif collection == 'terminals':
                    spec = native.model_dump(mode='json', exclude={'body_ref', 'pose', 'reference_terminal', 'evidence_refs'})
                    spec['reference_terminal'] = ref('terminals', native.reference_terminal).model_dump(mode='json') if native.reference_terminal else None
                    value = Terminal(**common, spec=TerminalSpec.model_validate_json(json.dumps(spec)),
                        body_ref=ref('bodies', native.body_ref) if native.body_ref else None, pose=native.pose)
                elif collection == 'energy_ports':
                    spec = native.model_dump(mode='json', exclude={'frame'})
                    spec['frame'] = {'body_ref': ref('bodies', native.frame.body_id).model_dump(mode='json'), 'pose': native.frame.pose.model_dump(mode='json')} if native.frame else None
                    value = DesignEnergyPort(**common, spec=DesignEnergySpec.model_validate_json(json.dumps(spec)))
                elif collection == 'information_ports':
                    value = InformationPort(**common, direction=native.direction, required=native.required,
                        type=StreamType(schema_id=native.data_type), interface_ref=ref('interfaces', native.interface_id) if native.interface_id else None,
                        body_ref=ref('bodies', native.frame.body_id) if native.frame else None, pose=native.frame.pose if native.frame else None)
                elif collection == 'material_ports':
                    value = MaterialPort(**common, direction=native.direction, medium=native.medium_ref,
                        body_ref=ref('bodies', native.body_ref), pose=native.pose,
                        spec=MaterialPortProperties(**{n: getattr(native, n) for n in ('medium_kind', 'aperture', 'connector', 'limits')}))
                elif collection == 'material_paths':
                    value = FlowEdge(source=src, domain='material', from_=ref('material_ports', native.inlet_port),
                        to=(ref('material_ports', native.outlet_port),), scope='internal', mechanism=native.mechanism)
                elif collection == 'interfaces':
                    value = LogicInterface(**common, protocol=native.protocol,
                        terminal_bindings={n: ref('terminals', t) for n, t in native.terminal_bindings.items()},
                        information_port_refs=tuple(ref('information_ports', n) for n, p in definition.information_ports.items() if p.interface_id == name))
                else:
                    behavior = getattr(native, 'behavior', native)
                    inputs = getattr(native, 'inputs', {}) if hasattr(native, 'behavior') else {}
                    if not hasattr(native, 'behavior') and hasattr(behavior, 'output_type'):
                        from element.interfaces.behavior_validation import input_signal_type
                        try: inputs = {n: input_signal_type(behavior) for n in behavior.inputs}
                        except (ValueError, KeyError) as exc:
                            resolved.issue('element.behavior_type', str(exc), target)
                    outputs = {'value': signal_type(behavior.output_type)} if hasattr(behavior, 'output_type') else {}
                    value = ElementUnit(**common, name=name, inputs={n: signal_type(t) for n, t in inputs.items()}, outputs=outputs)
                patch = patches.get(key)
                if isinstance(patch, InheritedObject):
                    # Element identity and ownership cannot be changed through a difference.
                    allowed = {'pose', 'placement'} if isinstance(value, Body) and name not in children else {'initial'} if isinstance(value, Joint) and value.kind != 'fixed' else set()
                    if set(patch.overrides) - allowed:
                        resolved.issue('element.override_intrinsic', 'Intrinsic properties belong to element; pin a derived definition to change them', target)
                    else:
                        try: value = type(value).model_validate_json(json.dumps(merge(value.model_dump(mode='json'), patch.overrides)))
                        except ValueError as exc: resolved.issue('element.override_invalid', str(exc), target)
                elif patch is not None:
                    if patch != value:
                        resolved.issue('element.source_conflict', 'Repeated attributes differ from the pinned source; use source and explicit overrides', target)
                replacements[target.key()] = value
                if key not in claims:
                    kind, target_collection = TARGETS[collection]
                    if target.record_id in authored: raise ValueError('Authored record collides with occurrence namespace')
                    entry = generated.setdefault(target.record_id, {'kind': kind, 'data': {}})
                    entry['data'].setdefault(target_collection, {})[target.object_id] = value.model_dump(mode='json')
    # Unavailable references stay editable, but are omitted from the effective view.
    for key, target in claims.items():
        if key not in resolved.element_objects:
            resolved.issue('element.local_ref', 'Pinned local source is unavailable', target)
    effective = {}
    for record in authored.values():
        raw = record.model_dump(mode='json')
        for collection in set(c for k, c in TARGETS.values() if k == record.kind):
            for name, value in list(getattr(record.data, collection).items()):
                key = f'{record.record_id}/{collection}/{name}'
                if key in replacements: raw['data'][collection][name] = replacements[key].model_dump(mode='json')
                elif isinstance(value, InheritedObject): del raw['data'][collection][name]
        effective[record.record_id] = parse_record(raw)
    for rid, raw in generated.items():
        effective[rid] = parse_record(dict(raw, design_id=resolved.package.manifest.design_id, record_id=rid, title='Resolved element occurrence'))
    resolved.records = effective
