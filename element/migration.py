"""Explicit lossless category adapters and revision migration reports."""
import copy
import json
from element.base.quantity import Quantity
from element.io.components import parse_component
from element.io.records import record_hash
from element.schema.professional import ElementDefinitionV2


def local_ref(collection, id):
    return {'domain': 'mechanical', 'collection': collection, 'id': id}


def migrate_joint(joint):
    d = joint.model_dump(mode='json')
    dimension = 'length' if joint.kind == 'prismatic' else 'angle'
    result = {'type': joint.kind, 'parent': local_ref('links', joint.parent_body.object_id),
              'child': local_ref('links', joint.child_body.object_id),
              'origin': d['parent_anchor'], 'child_origin': d['child_anchor'],
              'evidence_refs': d['evidence_refs']}
    if joint.axis is not None: result['axis'] = list(joint.axis)
    limits = {}
    if joint.position_limit:
        limits.update(lower=joint.position_limit.min.require(dimension), upper=joint.position_limit.max.require(dimension))
    if joint.velocity_limit: limits['velocity'] = joint.velocity_limit.require('speed' if dimension == 'length' else 'angular_speed')
    if joint.effort_limit: limits['effort'] = joint.effort_limit.require('force' if dimension == 'length' else 'torque')
    if limits: result['limit'] = limits
    return result


def migrate_component(component, *, library_id, revision=None):
    model = parse_component(component)
    d = model.model_dump(mode='json')
    old_hash = record_hash(d, 'project-component-v1')
    revision = revision if revision is not None else model.revision + 1
    if revision <= model.revision: raise ValueError('Migration requires a new revision')
    result = {'library_id': library_id, 'element_id': model.id, 'revision': revision,
              'name': model.name, 'category': model.category}
    for field in ('parameters', 'functions', 'principles', 'realizations', 'sources', 'evidence', 'roles', 'procurement'):
        if field in d: result[field] = d.pop(field)
    links = {k: {**v, 'visuals': {}, 'collisions': {}, 'spaces': {}} for k, v in d['geometry']['bodies'].items()}
    warnings = []
    for key, env in d['geometry']['envelopes'].items():
        shape = copy.deepcopy(env['shape'])
        kind = shape.pop('kind')
        if kind == 'convex_asset':
            raise ValueError('Convex asset migration requires an explicit unit and geometry interpretation')
        interpretation = shape.pop('collision_mode', 'solid')
        shape['type'] = 'mesh' if kind == 'triangle_mesh' else kind
        value = {'origin': env['pose'], 'geometry': shape}
        if env['purpose'] == 'solid':
            value.update(interpretation=interpretation, approximation=env['approximation'],
                         margin_m=env['margin_m'], evidence_refs=env['evidence_refs'])
            links[env['body_ref']]['collisions'][key] = value
            if env['approximation'] == 'outer': warnings.append('outer approximation requires evidence audit: ' + key)
        else:
            links[env['body_ref']]['spaces'][key] = {**value, 'kind': env['purpose']}
    for key, visual in d['geometry']['visual_assets'].items():
        # Old visual assets do not declare units: never silently guess millimetres.
        raise ValueError('Visual asset migration requires explicit unit: ' + key)
    m = {'root_link': d['geometry']['root_body'], 'links': links,
         'mounts': d['mounts']['ports'], 'joints': {}, 'couplings': {}, 'initial_positions': {}, 'drives': {}}
    joints = dict(getattr(getattr(model, 'motion', None), 'joints', {}))
    if hasattr(model, 'joint'): joints['axis'] = model.joint
    for key, joint in joints.items():
        m['joints'][key] = migrate_joint(joint)
        m['drives'][key] = joint.drive_mode
        if joint.initial_position: m['initial_positions'][key] = joint.initial_position.require(joint.dimension)
    if hasattr(model, 'motion'): m['couplings'] = d['motion']['transmissions']
    result['mechanical'] = m
    wiring_field = 'electrical' if 'electrical' in d else 'wiring'
    wiring = d.get(wiring_field) or {'terminals': {}, 'connectors': {}}
    if model.category == 'power' and not d.get(wiring_field):
        wiring = model.electrical.model_dump(mode='json')
    pins = {}
    for key, t in wiring['terminals'].items():
        role = t['electrical_role']
        power = {k: t[k] for k in ('voltage_limits', 'nominal_voltage', 'current_limits') if t.get(k) is not None}
        if role in ('power_in', 'power_out', 'ground'):
            power['role'] = {'power_in': 'sink', 'power_out': 'source', 'ground': 'reference'}[role]
        pins[key] = {'number': t['physical_pin_number'], 'name': t['label'],
            'electrical_type': 'passive' if role == 'ground' else role,
            'power': power or None, 'default_config': {'drive': t['drive'], 'pull': t['pull']},
            'physical': {'link': t['body_ref'], 'origin': t['pose']} if t['body_ref'] else None,
            'reference_pin': t['reference_terminal'], 'evidence_refs': t['evidence_refs']}
    result['electrical'] = {'pins': pins, 'connectors': wiring['connectors'], 'interfaces': d.get('interfaces', {})}
    behavior_fields = ('control', 'control_functions', 'channels', 'text', 'frequency')
    result['behavior'] = {'models': {k: d[k] for k in behavior_fields if k in d and d[k] is not None},
                         'sensors': {k: d[k] for k in ('controls', 'measurements') if k in d}}
    result['flow'] = {'material': d['material']} if 'material' in d else {}
    if 'cad_housing' in d: result['manufacturing'] = {'cad_housing': d['cad_housing']}
    excluded = {'id', 'revision', 'name', 'category', 'record_kind', 'design_version', 'dsl_version',
                'geometry', 'mounts', 'motion', 'joint', wiring_field, 'interfaces', 'material', 'cad_housing',
                *behavior_fields, 'controls', 'measurements'}
    result['specification'] = {k: v for k, v in d.items() if k not in excluded}
    result['authoring'] = {'category_adapter': 'component_design/1', 'wiring_field': wiring_field,
                           'source_revision': model.revision, 'source_hash': old_hash}
    new = ElementDefinitionV2.model_validate_json(json.dumps(result))
    # Parsing through the category union catches invalid specification and cross references.
    lower_element(new)
    report = {'source_hash': old_hash, 'source_revision': model.revision, 'target_revision': revision,
        'target_hash': record_hash(new, 'element-v2'), 'warnings': warnings,
        'object_map': {f'bodies/{k}': f'mechanical/links/{k}' for k in links}}
    report['object_map'].update({f'terminals/{k}': f'electrical/pins/{k}' for k in pins})
    return new, report


def lower_element(element):
    e = element.model_dump(mode='json')
    d = {**e['specification'], 'id': e['element_id'], 'revision': e['revision'], 'name': e['name'], 'category': e['category']}
    for k in ('parameters', 'functions', 'principles', 'realizations', 'sources', 'evidence', 'roles'):
        d[k] = e[k]
        if k in ('parameters', 'sources', 'evidence') and 'category_' + k in e['authoring']:
            d[k] = {id: e[k][id] for id in e['authoring']['category_' + k]}
    if e['procurement'] is not None: d['procurement'] = e['procurement']
    m = e['mechanical']
    geometry = {'root_body': m['root_link'], 'bodies': {}, 'envelopes': {}, 'visual_assets': {}}
    for key, link in m['links'].items():
        geometry['bodies'][key] = {k: link[k] for k in ('description', 'mass', 'inertia_ref', 'color') if link.get(k) is not None}
        for collection in ('collisions', 'spaces'):
            for id, g in link[collection].items():
                shape = copy.deepcopy(g['geometry'])
                kind = shape.pop('type')
                if kind == 'brep': raise ValueError('STEP requires occt_geometry; legacy layout cannot lower BRep')
                shape['kind'] = 'triangle_mesh' if kind == 'mesh' else kind
                if kind == 'mesh': shape['collision_mode'] = g.get('interpretation', 'surface')
                geometry['envelopes'][id] = {'body_ref': key, 'pose': g['origin'], 'shape': shape,
                    'purpose': 'solid' if collection == 'collisions' else g['kind'],
                    'approximation': g.get('approximation', 'unknown') if g.get('approximation') != 'tessellated' else 'unknown',
                    'margin_m': g.get('margin_m', 0), 'evidence_refs': g.get('evidence_refs', [])}
        for id, visual in link['visuals'].items():
            if visual['geometry']['type'] not in ('mesh', 'brep'):
                continue
            geometry['visual_assets'][id] = {'body_ref': key, 'pose': visual['origin'], 'asset_ref': visual['geometry']['asset_ref']}
    d['geometry'], d['mounts'] = geometry, {'ports': m['mounts']}
    joints = {}
    for id, j in m['joints'].items():
        unit = 'm' if j['type'] == 'prismatic' else 'rad'
        limits = j['limit'] or {}
        v = {'kind': j['type'], 'parent_body': {'collection': 'bodies', 'object_id': j['parent']['id']},
             'child_body': {'collection': 'bodies', 'object_id': j['child']['id']},
             'parent_anchor': j['origin'], 'child_anchor': j['child_origin'], 'axis': j['axis'],
             'drive_mode': m['drives'].get(id, 'passive'), 'evidence_refs': j['evidence_refs']}
        if limits.get('lower') is not None and limits.get('upper') is not None:
            v['position_limit'] = {'min': {'value': limits['lower'], 'unit': unit}, 'max': {'value': limits['upper'], 'unit': unit}}
        if id in m['initial_positions']: v['initial_position'] = {'value': m['initial_positions'][id], 'unit': unit}
        for field, target, u in (('velocity', 'velocity_limit', 'm/s' if unit == 'm' else 'rad/s'),
                                 ('effort', 'effort_limit', 'N' if unit == 'm' else 'N*m')):
            if limits.get(field) is not None: v[target] = {'value': limits[field], 'unit': u}
        joints[id] = v
    if e['category'] == 'actuator': d['joint'] = joints['axis']
    elif joints or m['couplings'] or e['category'] in ('transmission', 'energy_storage'):
        d['motion'] = {'joints': joints, 'transmissions': m['couplings']}
    terminals = {}
    for id, p in e['electrical']['pins'].items():
        power = p['power'] or {}
        role = 'ground' if power.get('role') == 'reference' else p['electrical_type']
        if role not in ('power_in', 'power_out', 'ground', 'input', 'output', 'bidirectional', 'passive'):
            raise ValueError('Pin type cannot be represented by legacy executor: ' + role)
        terminals[id] = {'physical_pin_number': p['number'], 'label': p['name'], 'electrical_role': role,
            'drive': p['default_config'].get('drive', 'none'), 'pull': p['default_config'].get('pull', 'none'),
            'body_ref': p['physical']['link'] if p['physical'] else None,
            'pose': p['physical']['origin'] if p['physical'] else None, 'reference_terminal': p['reference_pin'],
            'evidence_refs': p['evidence_refs'], **{k: power[k] for k in ('voltage_limits', 'nominal_voltage', 'current_limits') if k in power}}
    if terminals or e['electrical']['connectors'] or e['category'] not in ('structure', 'transmission', 'transport', 'energy_storage'):
        d[e['authoring'].get('wiring_field', 'wiring')] = {'terminals': terminals, 'connectors': e['electrical']['connectors']}
    if e['electrical']['interfaces']: d['interfaces'] = e['electrical']['interfaces']
    d.update(e['behavior']['models'])
    d.update(e['behavior']['sensors'])
    d.update(e['behavior']['effects'])
    d.update({k: v for k, v in e['flow'].items() if k not in ('information_ports', 'energy_ports')})
    d.update(e['manufacturing'])
    return parse_component(d)


def migrate_definition(value, *, revision=None):
    """Preserve both v1 metadata namespaces without overwriting conflicting IDs."""
    from element.io.records import parse_element
    old = parse_element(value)
    if old.schema_version != '1.0.0-draft': raise ValueError('Expected historical element v1')
    migrated, report = migrate_component(old.model, library_id=old.library_id, revision=revision)
    d = migrated.model_dump(mode='json')
    for field in ('aliases', 'subtype', 'form', 'origin', 'tags', 'product', 'description_markdown'):
        d[field] = old.model_dump(mode='json')[field]
    d['name'] = old.name
    d['roles'] = list(dict.fromkeys([*old.roles, *old.model.roles]))
    maps = {}
    for field in ('parameters', 'sources', 'evidence'):
        d['authoring']['category_' + field] = list(d[field])
        maps[field] = {}
        for id in getattr(old, field):
            new_id = 'definition__' + id
            while new_id in d[field]: new_id = 'definition__' + new_id
            maps[field][id] = new_id
    for field in ('sources', 'evidence', 'parameters'):
        for id, item in getattr(old, field).items():
            value = item.model_dump(mode='json')
            if field == 'evidence': value['source_ids'] = [maps['sources'][s] for s in value['source_ids']]
            if field == 'parameters': value['evidence_ids'] = [maps['evidence'][e] for e in value['evidence_ids']]
            d[field][maps[field][id]] = value
    d['capabilities'] = {}
    for id, cap in old.capabilities.items():
        value = cap.model_dump(mode='json')
        value['evidence_ids'] = [maps['evidence'][e] for e in value['evidence_ids']]
        d['capabilities'][id] = value
    d['flow'].update(information_ports={k: v.model_dump(mode='json') for k, v in old.information_ports.items()},
                     energy_ports={k: v.model_dump(mode='json') for k, v in old.energy_ports.items()})
    migrated = ElementDefinitionV2.model_validate_json(json.dumps(d))
    report.update(source_hash=record_hash(old), target_hash=record_hash(migrated, 'element-v2'), metadata_map=maps)
    return migrated, report
