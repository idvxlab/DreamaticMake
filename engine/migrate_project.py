"""Explicit v2 -> v3 migration, preserving old definitions and a baseline report.

Usage: python -m engine.migrate_project SOURCE DESTINATION
Use a distinct destination for normal migrations. In-place migration is explicit.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from element.io.records import element_ref, record_hash
from element.io.save import canonical_json
from element.migration import migrate_component
from engine.project_io import load_project, _read, load_design_package
from engine.layout import import_layout
from engine.design.professional import ElementIndex, Structure, Motion, Electrical, Logic


def migrate_project(source, destination):
    source, destination = Path(source).resolve(strict=True), Path(destination).resolve()
    old_manifest = _read(source, 'project.json')
    if old_manifest['project_version'] != 2: raise ValueError('Explicit migration accepts project v2 only')
    old = load_project(source)
    baseline = import_layout(old)
    from element.base.frame import Pose
    incoming = {j['child'] for j in baseline['joints'].values()}
    for id, placement in old['structure']['placements'].items():
        root_link = old['elements'][id]['geometry']['root_body']
        ref = f'{id}/bodies/{root_link}'
        if ref not in incoming: continue
        actual = Pose.model_validate_json(json.dumps(baseline['bodies'][ref]['pose']))
        explicit = Pose.model_validate_json(json.dumps(placement))
        delta = explicit.inverse().compose(actual)
        if max(abs(v) for v in delta.translation_m) > 1e-9 or abs(abs(delta.rotation_xyzw[3])-1) > 1e-9:
            raise ValueError('Migration conflict: explicit placement differs from joint pose: ' + ref)
    if source != destination:
        if destination.exists(): raise ValueError('Migration destination must not exist')
        if any(p.is_symlink() or p.is_junction() for p in source.rglob('*')):
            raise ValueError('Migration requires a project without linked files/directories')
        shutil.copytree(source, destination, ignore=shutil.ignore_patterns('.env', '.env.*', 'workspace', '__pycache__'))

    def write(relative, data):
        path = destination / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')

    index, cache, reports = {'instances': {}}, {}, {}
    old_index = _read(source, old_manifest['element_index'])
    write('doc/migration/project-v2.json', old_manifest)
    write('doc/migration/element-index-v1.json', old_index)
    write('doc/migration/layout-v2.json', old)
    for id, model in old['elements'].items():
        model = dict(model)
        model.pop('software', None)
        identity = record_hash(model, 'migration-input')
        if identity not in cache:
            definition, report = migrate_component(model, library_id=old_manifest['id'])
            folder = old_index['elements'][id]['path']
            if old_index['elements'][id]['kind'] == 'library': folder = Path(folder).stem
            relative = f'element/{folder}/element.json'
            write(relative, definition.model_dump(mode='json', exclude_none=True))
            cache[identity] = (definition, relative.removeprefix('element/'))
            reports[relative] = report
        definition, path = cache[identity]
        index['instances'][id] = {'element_ref': element_ref(definition).model_dump(mode='json'),
                                  'location': {'kind': 'custom', 'path': path}, 'name': model['name']}
    index = ElementIndex.model_validate_json(json.dumps(index)).model_dump(mode='json')
    write('element/index.json', index)
    incoming = {j['child'] for j in baseline['joints'].values()}
    roots = {ref.replace('/bodies/', '/links/'): b['pose'] for ref, b in baseline['bodies'].items() if ref not in incoming}
    structure = Structure.model_validate_json(json.dumps({'record_id': 'structure', 'root_placements': roots}))
    motion = {'record_id': 'motion', 'joints': {}, 'initial_positions': {}}
    for id, joint in old['motion']['joints'].items():
        def ref(value):
            parts = value.split('/')
            return {'instance': parts[0], 'domain': 'mechanical', 'collection': 'links', 'id': parts[-1]}
        j = {'type': joint['kind'], 'parent': ref(joint['parent']), 'child': ref(joint['child']),
             'origin': joint['parent_anchor'], 'child_origin': joint['child_anchor']}
        if joint['axis'] is not None: j['axis'] = joint['axis']
        limit = {k: joint[k] for k in ('lower', 'upper') if joint[k] is not None}
        if limit: j['limit'] = limit
        motion['joints'][id] = j
        if joint['initial'] is not None: motion['initial_positions'][id] = joint['initial']
    for id, config in old['motion']['configuration'].items():
        parts = id.split('/')
        resolved = f'{parts[0]}/joints/{parts[-1]}'
        if config['initial'] is not None: motion['initial_positions'][resolved] = config['initial']
        if config['lower'] is not None or config['upper'] is not None:
            raise ValueError('Migration of project limit narrowing requires explicit configurations')
    if old['motion']['transmissions']: raise ValueError('Migration requires explicit coupling review')
    motion = Motion.model_validate_json(json.dumps(motion))
    electrical = Electrical.model_validate_json(json.dumps({'record_id': 'electrical', 'nets': {
        id: {'name': id, 'kind': net['kind'], 'nodes': [{'instance': value.split('/')[0], 'domain': 'electrical',
            'collection': 'pins', 'id': value.split('/')[-1]} for value in net['members']]}
        for id, net in old['circuit_logic']['nets'].items()}}))
    software_projects = {}
    for id, model in old['elements'].items():
        if not model.get('software'): continue
        software = model['software']
        folder = destination / software['relative_path']
        inventory = {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in sorted(folder.rglob('*')) if p.is_file() and not p.name.startswith('.env')}
        software_projects[id] = {**{k: v for k, v in software.items() if k != 'schema_version'},
            'owner_instance': id, 'source_manifest_hash': hashlib.sha256(canonical_json(inventory).encode()).hexdigest(),
            'target': 'concept-controller', 'relation_to_model': 'not_verified'}
    logic = Logic.model_validate_json(json.dumps({'record_id': 'logic', 'software_projects': software_projects}))
    records = {'structure': structure, 'motion': motion, 'circuit_logic': electrical, 'logic': logic}
    paths = {**old_manifest['design'], 'logic': 'design/logic.json'}
    for field, record in records.items(): write(paths[field], record.model_dump(mode='json'))
    manifest = {**old_manifest, 'project_version': 3, 'schema_version': '3.0.0-draft', 'design': paths,
        'element_index_hash': record_hash(index, 'project-index-v3'), 'record_pins': {
            field: {'record_id': record.record_id, 'revision': record.revision, 'content_hash': record_hash(record, 'design-record-v3')}
            for field, record in records.items()}}
    write('project.json', manifest)
    package = load_design_package(destination)
    from engine.design.professional import resolved_poses
    poses = resolved_poses(package)
    errors = []
    for ref, pose in poses.items():
        from element.base.frame import Pose
        previous = Pose.model_validate_json(json.dumps(baseline['bodies'][ref.replace('/links/', '/bodies/')]['pose']))
        delta = previous.inverse().compose(pose)
        if max(abs(x) for x in delta.translation_m) > 1e-9 or abs(abs(delta.rotation_xyzw[3]) - 1) > 1e-9:
            errors.append(ref)
    write('doc/migration/project-v2.json', old_manifest)
    write('doc/migration/element-index-v1.json', old_index)
    write('doc/migration/layout-v2.json', old)
    write('doc/migration/report.json', {'schema_version': 'migration_report/1', 'elements': reports,
        'source_snapshot_hash': record_hash(old, 'layout-project-v2'), 'target_snapshot_id': package.snapshot_id,
        'instance_count': len(index['instances']), 'link_count': len(poses), 'root_count': len(roots),
        'net_count': len(electrical.nets), 'pose_conflicts': errors,
        'coverage': ['initial-pose equivalence'], 'not_checked': ['firmware', 'manufacturing', 'continuous collision']})
    if errors: raise ValueError('Migration pose conflicts: ' + ', '.join(errors))
    return package


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('destination')
    args = parser.parse_args()
    p = migrate_project(args.source, args.destination)
    print(json.dumps({'snapshot_id': p.snapshot_id, 'instances': len(p.index.instances)}))
