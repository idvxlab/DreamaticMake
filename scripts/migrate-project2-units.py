"""Explicit one-time project_2 composition migration; preserves geometry and FK evidence.

The old snapshot, leaf poses and BOM are recorded under ignored workspace/ before edits.
"""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.project_io import load_design_package
from engine.design.professional import resolved_poses, bill_of_materials, ElementIndex, Structure, Motion, Electrical
from element.schema.professional import ElementDefinitionV2
from element.io.records import element_ref, record_hash
from engine.design.authoring import compact_record

ROOT = Path('examples/project_2')


def read(path): return json.loads(path.read_text(encoding='utf-8'))
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def migrate():
    old = load_design_package(ROOT)
    if any(d.units for d in old.elements.values()): raise ValueError('Project is already composed')
    names = ('snooze', 'stop', 'set', 'minus', 'plus')
    mapping = {f'{prefix}_{name}': (f'button_{name}', child) for name in names
               for prefix, child in (('guide','guide'), ('gate','gate'), ('cap','cap'), ('pcb','retainer'), ('button','switch'))}
    before = {'snapshot_id': old.snapshot_id, 'poses': {k:v.model_dump(mode='json') for k,v in resolved_poses(old).items()},
              'bom': bill_of_materials(old), 'mapping': {k:'/'.join(v) for k,v in mapping.items()}}
    write(Path('workspace/migrations/project2-units-before.json'), before)
    index = old.index.model_dump(mode='json')
    structure = old.structure.model_dump(mode='json')
    motion = old.motion.model_dump(mode='json')
    circuit = old.circuit_logic.model_dump(mode='json')

    def local(ref):
        owner, child = mapping[ref['instance']]
        return {'unit_path':[child], **{k:v for k,v in ref.items() if k not in ('instance', 'unit_path')}}
    def external(ref):
        if ref['instance'] not in mapping: return ref
        owner, child = mapping[ref['instance']]
        id = ref['id']
        if ref['collection'] == 'links': id = 'body' if child == 'guide' else 'moving'
        elif ref['collection'] == 'mounts': id = child + '_' + id
        return {**ref, 'instance':owner, 'id':id}

    for name in names:
        owner = 'button_' + name
        large = name == 'snooze'
        folder = 'button_assembly_large' if large else 'button_assembly_small'
        units, internal_joints, mounts = {}, {}, {}
        exports = {'mechanical': {'links':{}, 'mounts':{}, 'joints':{
            'press':{'domain':'mechanical','collection':'joints','id':'press'}}}, 'electrical': {'pins':{}}}
        for original, (parent, child) in mapping.items():
            if parent != owner: continue
            item = old.index.instances[original]
            units[child] = {'kind':'reference', 'element_ref':item.element_ref.model_dump(mode='json'),
                            'location':item.location.model_dump(mode='json')}
            d = old.definition(original)
            for id in d.mechanical.mounts:
                exports['mechanical']['mounts'][child+'_'+id] = {'unit_path':[child], 'domain':'mechanical', 'collection':'mounts', 'id':id}
            if child in ('guide', 'cap'):
                exports['mechanical']['links']['body' if child=='guide' else 'moving'] = {
                    'unit_path':[child], 'domain':'mechanical', 'collection':'links', 'id':'body'}
            for id in d.electrical.pins:
                exports['electrical']['pins'][id] = {'unit_path':[child], 'domain':'electrical', 'collection':'pins', 'id':id}
        for id, joint in list(motion['joints'].items()):
            if all(mapping.get(joint[end]['instance'], (None,))[0] == owner for end in ('parent','child')):
                del motion['joints'][id]
                local_id = 'press' if joint['type']=='prismatic' else 'mount_'+mapping[joint['child']['instance']][1]
                internal_joints[local_id] = {**joint, **{end:local(joint[end]) for end in ('parent','child')}}
        for id, connection in list(structure['mount_connections'].items()):
            if all(mapping.get(connection[end]['instance'], (None,))[0] == owner for end in ('a','b')):
                del structure['mount_connections'][id]
                mounts[id] = {**connection, **{end:local(connection[end]) for end in ('a','b')}}
        definition = ElementDefinitionV2.model_validate_json(json.dumps({
            'schema_version':'3.0.0-draft', 'library_id':'project2', 'element_id':'clock.'+folder,
            'revision':1, 'name': 'Large button assembly' if large else 'Small button assembly',
            'category':'structure', 'form':'assembly', 'units':units, 'exports':exports, 'bom':{'policy':'children'},
            'mechanical':{'joints':internal_joints, 'mount_connections':mounts, 'initial_positions':{'press':0.0}},
            'description_markdown':'Reusable local button assembly. Source geometry and switch behavior are unchanged. '
                'Keycap travel does not imply a simulated electrical contact or physical fit.'}))
        # Four small instances must resolve to the same immutable definition.
        # Connection IDs/metadata are normalized to local names before pinning.
        value = definition.model_dump(mode='json')
        value['mechanical']['mount_connections'] = {f'fastener_{n}': {**c, 'connection_id':f'fastener/{n}'}
            for n,c in enumerate(value['mechanical'].get('mount_connections',{}).values())}
        definition = ElementDefinitionV2.model_validate_json(json.dumps(value))
        target = ROOT/'element'/folder/'element.json'
        if target.exists() and read(target) != definition.model_dump(mode='json'):
            raise ValueError('Repeated assembly definitions differ')
        write(target, definition.model_dump(mode='json'))
        write(target.parent/'manifest.json', {'record_kind':'element_package','package_version':'1',
            'name':definition.name,'category':definition.category,'element_path':'element.json'})
        for original, pair in mapping.items():
            if pair[0] == owner: index['instances'].pop(original)
        index['instances'][owner] = {'element_ref':element_ref(definition).model_dump(mode='json'),
            'location':{'kind':'custom','path':folder+'/element.json'}, 'name':name+' button assembly', 'refdes':None, 'config':{}}
    for joint in motion['joints'].values():
        for end in ('parent','child'): joint[end] = external(joint[end])
    motion['initial_positions'] = {}  # Owned by the reusable mechanism; project may override explicitly.
    for connection in structure['mount_connections'].values():
        for end in ('a','b'): connection[end] = external(connection[end])
    for net in circuit['nets'].values(): net['nodes'] = [external(r) for r in net['nodes']]
    for u in circuit['unconnected']: u['pin'] = external(u['pin'])
    for record in (structure, motion, circuit): record['revision'] += 1
    parsed_index = ElementIndex.model_validate_json(json.dumps(index))
    write(ROOT/'element/index.json', parsed_index.model_dump(mode='json'))
    manifest = old.manifest.model_dump(mode='json')
    manifest['element_index_hash'] = record_hash(parsed_index,'project-index-v3')
    for field, cls, value in (('structure', Structure, structure), ('motion', Motion, motion), ('circuit_logic', Electrical, circuit)):
        record = cls.model_validate_json(json.dumps(value))
        write(ROOT/manifest['design'][field], compact_record(record))
        manifest['record_pins'][field].update(revision=record.revision, content_hash=record_hash(record,'design-record-v3'))
    write(ROOT/'project.json', manifest)
    new = load_design_package(ROOT)
    poses = resolved_poses(new)
    for ref, expected in before['poses'].items():
        instance, suffix = ref.split('/',1)
        mapped = '/'.join(mapping[instance]) if instance in mapping else instance
        if poses[mapped+'/'+suffix].model_dump(mode='json') != expected: raise AssertionError('FK changed: '+ref)
    assert sum(g['quantity'] for g in bill_of_materials(new)) == 38
    config = read(ROOT/'analysis/tools.json')
    config['subject_snapshot_id'] = new.snapshot_id
    def states(value):
        if isinstance(value, dict):
            if 'positions' in value:
                value['positions'] = {('button_'+r.split('/')[1]+'/joints/press' if r.startswith('press/') else r):v
                    for r,v in value['positions'].items()}
            for child in value.values(): states(child)
        elif isinstance(value, list):
            for child in value: states(child)
    for profile in config['profiles']:
        profile['scope'] = ['/'.join(mapping[r]) if r in mapping else r for r in profile.get('scope',[])]
        states(profile.get('options', {}))
    write(ROOT/'analysis/tools.json', config)
    print(json.dumps({'snapshot':new.snapshot_id,'top_level':len(new.index.instances),'units':len(new.unit_occurrences()),
                      'joints':len(new.effective_joints()), 'poses_preserved':len(poses),'bom_quantity':38}))


if __name__ == '__main__': migrate()
