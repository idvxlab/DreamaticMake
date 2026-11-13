"""Read native versions explicitly; v3 never passes through its legacy model property."""
import json
from element.io.records import record_hash
from engine.design.professional import DesignPackageV3, resolved_poses


def kind(source):
    if isinstance(source, DesignPackageV3): return 'design_v3'
    if isinstance(source, dict) and source.get('project_version') == 2: return 'layout_v2'
    raise ValueError('Unsupported native design version')


def snapshot_id(source):
    return source.snapshot_id if kind(source) == 'design_v3' else record_hash(source, 'tools-layout-v2')


def pointer(*parts): return '/' + '/'.join(str(p).replace('~', '~0').replace('/', '~1') for p in parts)


def poses(source, positions):
    if kind(source) == 'design_v3':
        return resolved_poses(source, positions)
    from engine.layout import import_layout, parse_layout, motion
    layout = parse_layout(import_layout(source))
    if any(k not in layout.joints or layout.joints[k].kind == 'fixed' for k in positions):
        raise ValueError('Position references unknown or fixed joint')
    values, report = motion(layout, positions)
    if report.get('status') != 'completed': raise ValueError(str(report))
    return values


def collision_entries(source):
    if kind(source) == 'design_v3':
        entries = []
        missing = []
        for instance, node in source.unit_occurrences().items():
            for link_id, link in source.definition(instance).mechanical.links.items():
                body = f'{instance}/links/{link_id}'
                if not link.collisions: missing.append(body)
                for id, graphic in link.collisions.items():
                    entries.append({'ref': f'{body}/collisions/{id}', 'body': body, 'owner': instance,
                        'pointer': node.pointer + pointer('mechanical', 'links', link_id, 'collisions', id),
                        'document': node.location.path,
                        **graphic.model_dump(mode='json')})
        return entries, missing
    from engine.layout import import_layout, parse_layout
    d = parse_layout(import_layout(source))
    entries = []
    for ref, envelope in d.envelopes.items():
        value = envelope.model_dump(mode='json')
        shape = dict(value['shape'])
        t = shape.pop('kind')
        shape['type'] = 'mesh' if t == 'triangle_mesh' else t
        interpretation = shape.pop('collision_mode', 'solid')
        owner = d.bodies[envelope.body].entity
        entries.append({'ref': ref, 'body': envelope.body, 'owner': owner,
            'pointer': pointer('elements', owner, 'geometry', 'envelopes', ref.split('/')[-1]),
            'geometry': shape, 'origin': value['pose'], 'margin_m': value['margin_m'],
            'interpretation': interpretation, 'approximation': value['approximation']})
    return entries, [body for body in d.bodies if not any(e['body'] == body for e in entries)]


def project_context(path, workspace=None):
    from pathlib import Path
    from element.io.load import read_record
    from element.io.package import package_file, pool_root
    from engine.project_io import load_project, load_design_package
    from .contracts import ToolContext
    from .assets import file_resolver
    root = Path(path).resolve(strict=True)
    if root.is_file(): root = root.parent
    manifest = json.loads(read_record(package_file(root, 'project.json')))
    roots = {'project': root}
    if manifest['project_version'] == 3:
        source = load_design_package(root)
        for id, item in source.unit_occurrences().items():
            roots[id] = package_file(root / 'element', item.location.path).parent if item.location.kind == 'custom' else package_file(pool_root(), item.location.path + '/manifest.json').parent
    else:
        source = load_project(root)
        from engine.interface.project_browser import element_root
        roots.update({id: element_root(root, source, id) for id in source['elements']})
    def scenario(relative): return read_record(package_file(root, relative))
    import hashlib
    namespace = hashlib.sha256(str(root).encode('utf-8')).hexdigest()
    return ToolContext(source, Path(workspace) if workspace else Path(__file__).resolve().parents[2] / 'workspace/tools/projects' / namespace,
        file_resolver(roots), scenario)
