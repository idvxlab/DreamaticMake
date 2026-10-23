"""Portable Markdown packages: one editable body per document, explicit revision on import."""
from pathlib import Path
from engine.design.io import parse_package, parse_record, make_package, record_ref
from engine.design.resolve import resolve_design
from element.io.save import canonical_json
from element.io.load import _record_object, MAX_BYTES
from element.io.records import parse_element

def export_documents(package, destination):
    package = parse_package(package)
    resolve_design(package)
    root = Path(destination)
    root.mkdir(parents=True, exist_ok=False)
    raw = package.model_dump(mode='json', by_alias=True)
    files = {}
    for record in raw['records']:
        if record['kind'] not in ('analysis', 'function'): continue
        path = f"{record['kind']}/{record['record_id']}.md"
        target = root / path
        target.parent.mkdir(exist_ok=True)
        # No duplicate Markdown body in metadata; the file is the editable source.
        target.write_text(record['data']['body'].pop('text'), encoding='utf-8', newline='\n')
        files[record['record_id']] = path
    (root / 'design-export.json').write_text(canonical_json({'package': raw, 'markdown_files': files}), encoding='utf-8')
    return root

def import_documents(source):
    root = Path(source).resolve(strict=True)
    def read(path):
        path = (root / path).resolve(strict=True)
        if not path.is_relative_to(root): raise ValueError('Document escapes export root')
        with path.open('rb') as stream: data = stream.read(MAX_BYTES+1)
        if len(data) > MAX_BYTES: raise ValueError('Document exceeds size limit')
        return data.decode('utf-8')
    export = _record_object(read('design-export.json'))
    if set(export) != {'package', 'markdown_files'}: raise ValueError('Invalid document export')
    raw = export['package']
    pins = {r['record_id']: r for refs in raw['manifest']['layers'].values() for r in refs}
    expected = {r['record_id'] for r in raw['records'] if r['kind'] in ('analysis', 'function')}
    if set(export['markdown_files']) != expected: raise ValueError('Markdown file mapping mismatch')
    changed = False
    records = []
    for record in raw['records']:
        if record['kind'] in ('analysis', 'function'):
            record['data']['body']['text'] = read(export['markdown_files'][record['record_id']])
        parsed = parse_record(record)
        pin = pins.get(parsed.record_id)
        if not pin: raise ValueError('Unpinned imported record')
        if record_ref(parsed).model_dump(mode='json') != pin:
            record['revision'] = pin['revision'] + 1
            changed = True
        records.append(parse_record(record))
    original = raw['manifest']
    package = make_package(design_id=original['design_id'], title=original['title'], records=records,
        revision=original['revision'] + int(changed), elements=tuple(parse_element(e) for e in raw['elements']),
        input_revisions=original['input_revisions'])
    resolve_design(package)
    return package
