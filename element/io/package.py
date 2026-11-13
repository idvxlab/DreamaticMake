"""Versioned, confined per-element folders; JSON files remain ordinary contracts."""
import os
from pathlib import Path, PurePosixPath
from element.io.load import _record_object, read_record


def pool_settings():
    config = Path(__file__).resolve().parents[2] / 'element-pool.json'
    settings = _record_object(read_record(config))
    local = config.with_name('element-pool.local.json')
    if local.is_file():
        settings.update(_record_object(read_record(local)))
    return config.parent, settings


def pool_root():
    configured = os.environ.get('DREAMATIC_ELEMENT_POOL')
    if configured:
        return Path(configured).resolve()
    directory, settings = pool_settings()
    return (directory / settings['root']).resolve()


def package_file(folder, relative):
    root = Path(folder).resolve(strict=True)
    if not isinstance(relative, str) or not relative:
        raise ValueError('Package file must be a relative path')
    path = PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts or any(c in relative for c in '\\:'):
        raise ValueError('Package path escapes element folder')
    target = (root / relative).resolve(strict=True)
    if not target.is_relative_to(root) or not target.is_file():
        raise ValueError('Package path escapes element folder or is not a file')
    return target


def read_package(folder):
    data = _record_object(read_record(package_file(folder, 'manifest.json')))
    if data.get('record_kind') != 'element_package' or data.get('package_version') != '1':
        raise ValueError('Unsupported element package')
    return data


def template_paths(root=None):
    root = Path(root) if root is not None else pool_root()
    result = {}
    for folder in sorted(root.iterdir()):
        if not folder.is_dir() or not (folder / 'manifest.json').is_file():
            continue
        manifest = read_package(folder)
        if name := manifest.get('template_name'):
            if name in result:
                raise ValueError('Duplicate template name: ' + name)
            result[name] = package_file(folder, manifest['component_path'])
    return result


def template_path(name):
    return template_paths()[name]


def scenario_path(name):
    component = template_path(name)
    return package_file(component.parent, read_package(component.parent)['scenario_path'])
