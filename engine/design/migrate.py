"""Explicit legacy layout migration with stable identities and a loss report."""
from hashlib import sha256
from engine.layout import parse_layout
from engine.design.io import make_package
from engine.design.contracts import ObjectRef

def migrate_layout(value, *, design_id='design', title='Imported layout'):
    layout = parse_layout(value)
    mapping = {}
    losses = []
    data = {'analysis': {'purpose': 'other', 'body': {'text': 'Imported legacy layout; selection versions require explicit resolution.'}},
            'function': {}, 'structure': {'bodies': {}, 'geometry': {}},
            'motion': {'joints': {}, 'transmissions': {}}, 'circuit_energy': {'terminals': {}, 'nets': {}},
            'flow': {'ports': {}, 'edges': {}, 'required_paths': {}}, 'logic': {}}
    selections = []
    def oid(key): return 'o_' + sha256(key.encode()).hexdigest()[:24]
    def ref(record, collection, key):
        return ObjectRef(record_id=record, collection=collection, object_id=oid(key)).model_dump(mode='json')
    groups = [('entities', 'selection', 'instances'), ('bodies', 'structure', 'bodies'),
              ('envelopes', 'structure', 'geometry'), ('joints', 'motion', 'joints'),
              ('transmissions', 'motion', 'transmissions')]
    for collection, record, target in groups:
        for key in getattr(layout, collection):
            mapping[key] = ref('selection_' + oid(key) if record == 'selection' else record, target, key)
    for key, port in layout.ports.items():
        mapping[key] = ref('circuit_energy' if port.domain == 'electrical' else 'flow', 'terminals' if port.domain == 'electrical' else 'ports', key)
    for key, edge in layout.edges.items():
        mapping[key] = ref('circuit_energy' if edge.domain == 'electrical' else 'flow', 'nets' if edge.domain == 'electrical' else 'edges', key)
    def lookup(key, record='structure', collection='bodies'):
        return mapping.get(key, ref(record, collection, key))
    for key, entity in layout.entities.items():
        selections.append({'kind': 'selection', 'record_id': mapping[key]['record_id'], 'data': {
            'decision': {'text': f'Legacy part_id: {entity.part_id or "unknown"}. Exact library revision is not pinned.'},
            'usage': {'kind': 'discrete', 'planned_count': 1, 'instances': {oid(key): {'label': entity.name}}}}})
    for key, body in layout.bodies.items():
        data['structure']['bodies'][oid(key)] = {'instance_ref': lookup(body.entity, 'selection', 'instances'),
            'pose': body.pose.model_dump(mode='json'), 'placement': 'specified'}
    for key, geo in layout.envelopes.items():
        data['structure']['geometry'][oid(key)] = {**geo.model_dump(mode='json', exclude={'body'}), 'body_ref': lookup(geo.body)}
    for key, joint in layout.joints.items():
        unit = 'm' if joint.kind == 'prismatic' else 'rad'
        d = joint.model_dump(mode='json', exclude={'parent', 'child', 'lower', 'upper', 'initial'})
        d.update(parent_body=lookup(joint.parent), child_body=lookup(joint.child))
        for field in ('lower', 'upper', 'initial'):
            v = getattr(joint, field)
            d[field] = {'value': v, 'unit': unit} if v is not None else None
        data['motion']['joints'][oid(key)] = d
    for key, t in layout.transmissions.items():
        data['motion']['transmissions'][oid(key)] = {'driver': lookup(t.driver, 'motion', 'joints'),
            'follower': lookup(t.follower, 'motion', 'joints'), 'kind': t.kind,
            'factor': {'value': t.factor, 'unit': '1' if t.kind == 'rotary_ratio' else 'm'} if t.factor is not None else None,
            'offset': {'value': t.offset, 'unit': 'rad' if t.kind == 'rotary_ratio' else 'm'}}
    for key, p in layout.ports.items():
        common = {'instance_ref': lookup(p.entity, 'selection', 'instances'),
                  'body_ref': lookup(p.body) if p.body else None, 'pose': p.pose.model_dump(mode='json') if p.pose else None}
        if p.domain == 'electrical':
            role = p.role if p.role in ('power_in','power_out','ground','input','output','bidirectional','passive') else 'passive'
            data['circuit_energy']['terminals'][oid(key)] = {**common, 'spec': {'physical_pin_number': '', 'label': p.name, 'electrical_role': role}}
            losses.append({'source': key, 'reason': 'Physical pin and ratings unavailable in legacy layout', 'legacy_port': p.model_dump(mode='json')})
        else:
            d = {**common, 'domain': p.domain, 'direction': p.direction, 'required': p.required}
            if p.domain == 'material': d['medium'] = p.medium
            else: d['type'] = {'kind': 'stream', 'schema_id': p.data_type} if p.data_type else None
            data['flow']['ports'][oid(key)] = d
    for key, edge in layout.edges.items():
        if edge.domain == 'electrical':
            kind = edge.kind if edge.kind in ('signal','power','ground') else 'signal'
            data['circuit_energy']['nets'][oid(key)] = {'kind': kind, 'members': [lookup(k, 'circuit_energy', 'terminals') for k in edge.members]}
            if edge.kind != kind or edge.directed:
                losses.append({'source': key, 'reason': 'Legacy electrical edge semantics require review', 'legacy_edge': edge.model_dump(mode='json')})
        elif not edge.directed:
            losses.append({'source': key, 'reason': 'Undirected flow retained in report; no direction inferred', 'legacy_edge': edge.model_dump(mode='json')})
        else:
            data['flow']['edges'][oid(key)] = {'domain': edge.domain, 'from': lookup(edge.members[0], 'flow', 'ports'),
                'to': [lookup(k, 'flow', 'ports') for k in edge.members[1:]], 'scope': 'internal' if edge.kind == 'internal' else 'external'}
    for i, path in enumerate(layout.paths):
        if path.domain == 'electrical':
            losses.append({'source': f'paths/{i}', 'reason': 'Electrical path assertion retained in report', 'legacy_path': path.model_dump(mode='json')})
        else:
            data['flow']['required_paths'][f'path_{i}'] = {'domain': path.domain, 'from': lookup(path.source, 'flow', 'ports'), 'to': lookup(path.target, 'flow', 'ports')}
    records = [{'kind': kind, 'record_id': kind, 'data': d} for kind, d in data.items()] + selections
    records = [{**r, 'design_id': design_id, 'title': r['record_id']} for r in records]
    package = make_package(design_id=design_id, title=title, records=records)
    return {'package': package.model_dump(mode='json', by_alias=True), 'identity_map': mapping,
            'losses': losses, 'original_layout': layout.model_dump(mode='json')}

def instantiate_element(definition, *, design_id='design', title=None):
    """Materialize a chosen, pinned element through the explicit legacy layout adapter."""
    from element.io.records import parse_element, element_ref
    from engine.adapters.elements import to_bundle
    from engine.layout import import_layout
    from engine.design.io import parse_package
    definition = parse_element(definition)
    layout = import_layout(to_bundle(definition.model).model_dump(mode='json'))
    result = migrate_layout(layout, design_id=design_id, title=title or definition.name)
    raw = result['package']
    records = raw['records']
    for record in records:
        if record['kind'] == 'selection':
            record['data']['candidates'] = {'chosen': {'element_ref': element_ref(definition).model_dump(mode='json')}}
            record['data']['chosen_candidate_id'] = 'chosen'
            record['data']['decision'] = {'text': 'Explicitly instantiated from a pinned element definition.'}
            for instance in record['data']['usage']['instances'].values():
                instance['occurrence_map'] = result['identity_map']
    package = make_package(design_id=design_id, title=title or definition.name, records=records, elements=(definition,))
    result['package'] = package.model_dump(mode='json', by_alias=True)
    # This is a projection adapter: execution-only metadata remains in the pinned element.
    result['losses'].append({'source': definition.element_id, 'reason': 'Behavior execution remains in the pinned element; layout materialization is not a simulation'})
    return result
