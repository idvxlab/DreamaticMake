"""Read-only software projection, scoped to controller declarations and project software/."""
import os
from pathlib import Path
from element.interfaces.software import SoftwareProject
from element.io.package import package_file

TEXT_SUFFIXES = {'.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.ino', '.py', '.rs', '.go',
    '.js', '.ts', '.jsx', '.tsx', '.java', '.cs', '.s', '.asm', '.json', '.toml', '.yaml',
    '.yml', '.ini', '.cfg', '.txt', '.md', '.cmake', '.csv', '.xml'}
SKIP_DIRS = {'node_modules', '__pycache__', 'build', 'dist', 'target', 'venv'}


def _target(root, relative):
    # Reject every link/junction, including software/ itself, before resolving.
    current = root
    for part in relative.split('/'):
        current = current / part
        if current.is_symlink() or current.is_junction():
            raise ValueError('Software links cannot traverse symlinks or junctions')
    target = current.resolve(strict=True)
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Software path escapes project')
    return target


def _files(root, relative):
    target = _target(root, relative)
    candidates = []
    visited = 0
    if target.is_file(): candidates = [target]
    elif target.is_dir():
        for directory, dirs, files in os.walk(target, followlinks=False):
            base = Path(directory)
            visited += len(dirs) + len(files)
            if visited > 5000: raise ValueError('Software exceeds the 5000-entry browsing limit')
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in SKIP_DIRS
                and not (base / d).is_symlink() and not (base / d).is_junction())
            candidates.extend(base / f for f in sorted(files))
    entries = []
    for path in candidates:
        name = path.relative_to(root).as_posix()
        if (any(p.startswith('.') for p in name.split('/')) or path.is_symlink() or path.is_junction()
                or (path.suffix.lower() not in TEXT_SUFFIXES and path.name not in ('Makefile', 'Dockerfile'))): continue
        entries.append({'path': name, 'size': path.stat().st_size})
        if len(entries) > 1000: raise ValueError('Software exceeds the 1000-file browsing limit')
    return sorted(entries, key=lambda item: item['path'])


def software_projects(root, source, selected=None):
    projects = []
    for key, model in source['elements'].items():
        if selected is not None and key != selected: continue
        if model.get('category') != 'controller' or not model.get('software'): continue
        link = SoftwareProject.model_validate(model['software'])
        if not link.relative_path: continue
        entry = {'element_key': key, 'name': model['name'], **link.model_dump(mode='json'), 'files': [], 'error': None}
        try: entry['files'] = _files(root, link.relative_path)
        except (OSError, ValueError) as exc: entry['error'] = str(exc)
        projects.append(entry)
    return {'projects': projects}


def software_preview(root, source, selected, owner, relative):
    projects = software_projects(root, source, selected)['projects']
    project = next((p for p in projects if p['element_key'] == owner), None)
    entry = next((f for f in project['files'] if f['path'] == relative), None) if project else None
    if entry is None: raise ValueError('File is outside the selected controller software project')
    _target(root, relative)
    path = package_file(root, relative)
    with path.open('rb') as stream: data = stream.read(2*1024*1024 + 1)
    if len(data) > 2*1024*1024: raise ValueError('Software file exceeds the 2 MiB preview limit')
    return {**entry, 'text': data.decode('utf-8-sig'), 'element_key': owner}
