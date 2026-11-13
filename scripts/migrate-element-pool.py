"""Stage a unified pool without changing the source. Destination must not exist."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from element.io.components import load_component


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def migrate(source, templates, destination):
    source, templates, destination = map(lambda p: Path(p).resolve(), (source, templates, destination))
    if destination.exists() or destination.is_relative_to(source):
        raise ValueError('Use a new staging directory outside the source pool')
    shutil.copytree(source, destination)
    index = json.loads((destination / 'index.json').read_text(encoding='utf-8-sig'))
    renames = {e['folder']: re.sub(r'^\d+_', '', e['folder']) for e in index['elements']}
    if len(set(renames.values())) != len(renames):
        raise ValueError('Folder rename collision')
    for old, new in renames.items():
        if old != new:
            (destination / old).rename(destination / new)
    # Rewrite path references only; original source identifiers remain provenance.
    for path in destination.rglob('*'):
        if path.suffix.lower() not in ('.json', '.md'):
            continue
        text = path.read_text(encoding='utf-8-sig')
        for old, new in renames.items():
            text = text.replace(old + '/', new + '/')
        path.write_text(text, encoding='utf-8')
    for entry in index['elements']:
        old = entry['folder']
        entry['original_id'] = old
        entry['folder'] = renames[old]
        for key in ('structured_path', 'element_path'):
            if entry.get(key): entry[key] = entry[key].replace(old + '/', renames[old] + '/')
        manifest = {**entry, 'record_kind': 'element_package', 'package_version': '1'}
        for key in ('structured_path', 'element_path'):
            if manifest.get(key): manifest[key] = manifest[key].split('/', 1)[1]
        write(destination / entry['folder'] / 'manifest.json', manifest)
    migrated, duplicate_map, hashes = [], {}, {}
    for path in sorted(templates.iterdir()):
        if path.suffix not in ('.json', '.toml') or path.name.endswith('.scenario.json'):
            continue
        model = load_component(path)
        data = json.loads(path.read_text(encoding='utf-8')) if path.suffix == '.json' else model.model_dump(mode='json')
        fingerprint = sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        if fingerprint in hashes:
            duplicate_map[path.name] = hashes[fingerprint]
            continue
        name = 'template_' + path.stem
        folder = destination / name
        folder.mkdir()
        write(folder / 'component.json', data)
        if path.suffix == '.toml': shutil.copy2(path, folder / 'input.toml')
        manifest = dict(record_kind='element_package', package_version='1', template_name=path.stem,
            name=model.name, category=model.category, status='synthetic_template', component_path='component.json')
        scenario = path.with_name(path.stem + '.scenario.json')
        if scenario.exists():
            shutil.copy2(scenario, folder / 'scenario.json')
            manifest['scenario_path'] = 'scenario.json'
        def assets(value):
            if isinstance(value, dict):
                if value.get('relative_path'):
                    relative = value['relative_path']
                    original = (templates / relative).resolve(strict=True)
                    if not original.is_relative_to(templates): raise ValueError('Template asset escape')
                    target = folder / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(original, target)
                for child in value.values(): assets(child)
            elif isinstance(value, list):
                for child in value: assets(child)
        assets(data)
        (folder / 'README.md').write_text('# ' + model.name + '\n\n合成示例；尺寸、额定值与行为仅用于软件演示，不代表真实料号。\n', encoding='utf-8')
        write(folder / 'manifest.json', manifest)
        index['elements'].append({**manifest, 'folder': name, 'component_path': name + '/component.json'})
        hashes[fingerprint] = name
        migrated.append(path.name)
    # Preserve the independently used mesh import example as another element.
    from element.categories import Structure
    from element.base.evidence import Evidence
    from element.base.reference import ObjectRef
    from engine.compiler.lower import compile_model
    from engine.schema.scenario import Scenario, RootPlacement
    assumed = {'demo': Evidence(kind='assumed', conditions='Synthetic offline component example',
        note='Illustrative dimensions and ratings; not manufacturer specifications or physical validation.')}
    asset_root = templates / 'assets'
    component = Structure.from_stl(id='example.imported_wedge', name='Synthetic imported wedge',
        path=asset_root / 'wedge.stl', asset_root=asset_root, unit='mm', collision_mode='solid', evidence=assumed)
    scenario = Scenario(id=component.id + '.demo', snapshot_id=compile_model(component).snapshot_id,
        duration_s=0.5, roots=(RootPlacement(body_ref=ObjectRef(collection='bodies', object_id='body')),))
    folder = destination / 'template_imported_wedge'
    folder.mkdir()
    write(folder / 'component.json', component.model_dump(mode='json'))
    write(folder / 'scenario.json', scenario.model_dump(mode='json'))
    shutil.copy2(asset_root / 'wedge.stl', folder / 'wedge.stl')
    manifest = dict(record_kind='element_package', package_version='1', template_name='imported_wedge',
        name=component.name, category=component.category, status='synthetic_template',
        component_path='component.json', scenario_path='scenario.json')
    write(folder / 'manifest.json', manifest)
    index['elements'].append({**manifest, 'folder': folder.name, 'component_path': folder.name + '/component.json'})
    history = destination / '_history' / 'before-folder-unification'
    history.mkdir(parents=True)
    for path in list(destination.glob('*.json')):
        if path.name != 'index.json': shutil.move(str(path), history / path.name)
    shutil.copy2(destination / 'README.md', history / 'README.md')
    index['counts'] = dict(Counter(e['status'] for e in index['elements']))
    index['counts']['records'] = len(index['elements'])
    index['date'] = '2026-11-05'
    write(destination / 'index.json', index)
    report = {'schema_version': '1', 'renames': renames, 'migrated': migrated,
        'exact_duplicates': duplicate_map, 'counts': index['counts'],
        'deduplication': 'Only identical full component records are merged. Synthetic and catalog parts remain distinct.'}
    write(destination / 'migration_report.json', report)
    (destination / 'README.md').write_text('''# 统一元件库

一个目录一个元件，无人为数字编号。目录名可改，稳定身份由元件 id/revision 决定。
每个目录的 manifest.json 使用 element_package / package_version 1。
component_path 指向 component.json；也可用 element_path 指向完整 element.json。
structured_path 指向未完全准入的结构化资料，不能伪装成可执行模型。
scenario_path、assets/、sources/、其他 JSON 和说明可与元件一起保存。
路径均相对于该元件目录，不能越界。所有 AssetRef 同样以元件目录为根。

index.json 是检索清单；不提供索引时加载器会扫描 manifest.json。
新增、改名后应更新索引，或删除缓存索引让加载器自动发现目录。
template_* 为合成模板，与真实料号分开保留；它们不是厂商尺寸或制造结果。
迁移前报告归档在 _history/，不代表迁移后文件校验结果。
迁移明细见 migration_report.json；STEP 执行记录见 step_generation_report.json。
原始来源和许可证保留在各元件目录和 _provenance/。
''', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('templates')
    parser.add_argument('destination')
    args = parser.parse_args()
    print(json.dumps(migrate(args.source, args.templates, args.destination), ensure_ascii=True, indent=2))
