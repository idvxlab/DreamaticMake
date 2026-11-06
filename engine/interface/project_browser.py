"""Read-only project/element file browsing with explicit roots and preview limits."""
import base64
import json
import os
from pathlib import Path

from element.io.load import _unique, _nonfinite, read_record
from element.io.package import package_file, pool_root
from engine.project_io import load_project, ProjectManifest
from element.base.reference import AssetRef
from element.io.load import read_asset
from element.io.mesh import MAX_STL_BYTES

DEFAULT_PROJECT = Path(__file__).resolve().parents[2] / 'examples/project_1'
PREVIEW_TYPES = {'.json': ('json', 'application/json'), '.md': ('markdown', 'text/markdown'),
    '.txt': ('text', 'text/plain'), '.pdf': ('pdf', 'application/pdf'),
    '.png': ('image', 'image/png'), '.jpg': ('image', 'image/jpeg'), '.jpeg': ('image', 'image/jpeg'),
    '.gif': ('image', 'image/gif'), '.webp': ('image', 'image/webp'), '.bmp': ('image', 'image/bmp'),
    '.svg': ('image', 'image/svg+xml'), '.avif': ('image', 'image/avif')}


def context(path=None):
    if path is not None and not isinstance(path, str): raise ValueError('Project path must be text')
    root = Path(path.strip()) if path and path.strip() else DEFAULT_PROJECT
    root = root.resolve(strict=True)
    if root.is_file() and root.name == 'project.json': root = root.parent
    source = load_project(root)
    manifest = ProjectManifest.model_validate_json(read_record(package_file(root, 'project.json')))
    return root, source, manifest


def project_info(root, source, manifest):
    return {'path': str(root), 'id': manifest.id, 'title': manifest.title,
        'targets': [{'key': key, 'name': model['name'], 'kind': source['element_sources'][key]['kind']}
            for key, model in source['elements'].items()]}


def selection_key(source, key):
    if key is not None and (not isinstance(key, str) or key not in source['elements']):
        raise ValueError('Unknown project element key')
    return key


def element_root(root, source, key):
    selection_key(source, key)
    location = source['element_sources'][key]
    if location['kind'] == 'custom':
        return package_file(root / 'element', location['path'] + '/manifest.json').parent
    library = pool_root().resolve(strict=True)
    return package_file(library, location['folder'] + '/manifest.json').parent


def mesh_asset(root, source, selected, owner, value):
    """Serve only a pinned mesh declared by the owning project element, never a file URL."""
    if not isinstance(owner, str): raise ValueError('Mesh requires an owning element')
    selection_key(source, owner)
    if selected is not None and owner != selected:
        raise ValueError('Mesh owner is outside the current element selection')
    ref = AssetRef.model_validate_json(json.dumps(value, allow_nan=False))
    if (not ref.relative_path or Path(ref.relative_path).suffix.lower() != '.stl'
            or any(p.startswith('.') for p in Path(ref.relative_path).parts)
            or ref.media_type not in ('model/stl', 'application/sla', 'application/vnd.ms-pki.stl')):
        raise ValueError('Only local declared STL meshes are supported')
    geometry = source['elements'][owner].get('geometry', {})
    declared = [e['shape'].get('asset_ref') for e in geometry.get('envelopes', {}).values()
        if e['shape']['kind'] == 'triangle_mesh']
    if not any(AssetRef.model_validate_json(json.dumps(item)) == ref for item in declared):
        raise ValueError('Mesh reference is not declared by this element')
    data = read_asset(ref, element_root(root, source, owner), MAX_STL_BYTES)
    return {'sha256': ref.sha256, 'media_type': ref.media_type,
        'data_base64': base64.b64encode(data).decode('ascii')}


def source_files(root, source, manifest, key=None):
    """Project view excludes element/ entirely; an element sees only its own package."""
    selection_key(source, key)
    base = element_root(root, source, key) if key is not None else root
    candidates = []
    if key is None:
        candidates.extend(base / name for name in ('project.json', 'README.md'))
        candidates.extend(package_file(root, name) for name in manifest.design.model_dump().values())
        folders = [base / 'design', base / 'doc']
    else:
        folders = [base]
    visited = 0
    for folder in folders:
        if not folder.is_dir() or folder.is_symlink() or folder.is_junction(): continue
        for current, dirs, files in os.walk(folder, followlinks=False):
            directory = Path(current)
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__')
                and not (directory / d).is_symlink() and not (directory / d).is_junction())
            visited += len(dirs) + len(files)
            if visited > 5000: raise ValueError('Source folder exceeds the 5000-entry browsing limit')
            candidates.extend(directory / name for name in files)
    result = {}
    for path in candidates:
        if path.suffix.lower() not in PREVIEW_TYPES or any(part.startswith('.') for part in path.relative_to(base).parts): continue
        if not path.is_file() or path.is_symlink(): continue
        relative = path.relative_to(base).as_posix()
        # Project metadata must not pull element definitions into the project source tree.
        if key is None and relative not in ('project.json', 'README.md') and relative.split('/')[0] not in ('design', 'doc'): continue
        target = package_file(base, relative)
        kind, media_type = PREVIEW_TYPES[target.suffix.lower()]
        result[relative] = {'path': relative, 'kind': kind, 'media_type': media_type, 'size': target.stat().st_size}
    if len(result) > 1000: raise ValueError('Source folder exceeds the 1000-file preview limit')
    return base, sorted(result.values(), key=lambda item: item['path'])


def preview(root, source, manifest, key, relative):
    base, files = source_files(root, source, manifest, key)
    entry = next((item for item in files if item['path'] == relative), None)
    if entry is None: raise ValueError('File is outside the current source selection or has an unsupported format')
    target = package_file(base, relative)
    limit = 8*1024*1024 if entry['kind'] in ('image', 'pdf') else 2*1024*1024
    with target.open('rb') as stream: data = stream.read(limit + 1)
    if len(data) > limit: raise ValueError('File exceeds the preview size limit')
    if entry['kind'] in ('image', 'pdf'):
        return {**entry, 'data_url': 'data:' + entry['media_type'] + ';base64,' + base64.b64encode(data).decode('ascii')}
    text = data.decode('utf-8-sig')
    if entry['kind'] == 'json':
        value = json.loads(text, object_pairs_hook=_unique, parse_constant=_nonfinite)
        text = json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2)
    return {**entry, 'text': text}
