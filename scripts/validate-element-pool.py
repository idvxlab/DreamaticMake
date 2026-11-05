"""Validate folder contracts and all asset pins, and write a current checksum inventory."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from element.io.components import load_component
from element.io.load import read_asset
from element.io.package import read_package, package_file
from element.base.reference import AssetRef
from element.library.pool import load_element_pool

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('root', type=Path)
args = parser.parse_args()
root = args.root.resolve(strict=True)
retriever = load_element_pool(root)
folders, asset_count = [], 0
for folder in sorted(root.iterdir()):
    if not folder.is_dir() or not (folder / 'manifest.json').is_file(): continue
    manifest = read_package(folder)
    for key in ('component_path', 'element_path', 'structured_path', 'scenario_path'):
        if manifest.get(key): package_file(folder, manifest[key])
    if manifest.get('component_path') or manifest.get('element_path'): load_component(folder)
    def validate(value):
        global asset_count
        if isinstance(value, dict):
            if value.get('relative_path') and value.get('sha256') and 'media_type' in value:
                ref = AssetRef.model_validate_json(json.dumps(value))
                read_asset(ref, folder, max_bytes=64*1024*1024)
                asset_count += 1
            for child in value.values(): validate(child)
        elif isinstance(value, list):
            for child in value: validate(child)
    for key in ('component_path', 'element_path'):
        if manifest.get(key): validate(json.loads(package_file(folder, manifest[key]).read_text(encoding='utf-8')))
    folders.append(folder.name)
if len(folders) != len(retriever.records): raise ValueError('Manifest/index record count differs')
report = {'schema_version': '1', 'records': len(folders), 'native_records': sum(r.native_ref is not None for r in retriever.records),
    'checked_asset_refs': asset_count, 'diagnostics': list(retriever.diagnostics), 'folders': folders}
(root / 'validation_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
checksums = {p.relative_to(root).as_posix(): sha256(p.read_bytes()).hexdigest()
    for p in sorted(root.rglob('*')) if p.is_file() and p.name != 'checksums.json'}
(root / 'checksums.json').write_text(json.dumps(checksums, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k != 'folders'}, ensure_ascii=True))
