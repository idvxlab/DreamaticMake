"""Read-only adapter for element_pool_2's index + structured/native definitions."""
from pathlib import Path, PurePosixPath
from pydantic import TypeAdapter
from element.base.quantity import Parameter
from element.io.load import _record_object, MAX_BYTES
from element.io.records import parse_element, record_hash
from element.io.save import canonical_json
from element.schema.retrieval import ParameterFact, RetrievalRef
from element.schema.library import Category
from element.library.local import LibraryError, normalize
from element.library.retrieval import ElementRetriever, SearchRecord, native_record


def load_element_pool(root) -> ElementRetriever:
    """No index creation, publication, source writes, asset loading or partial-model coercion."""
    root = Path(root).resolve(strict=True)
    budget = 64 * 1024 * 1024

    def read(relative):
        nonlocal budget
        if not isinstance(relative, str): raise ValueError('Pool JSON path must be a string')
        path = PurePosixPath(relative)
        if path.is_absolute() or '..' in path.parts or '\\' in relative or ':' in relative or path.suffix != '.json':
            raise LibraryError('path_escape', 'Expected a confined relative JSON path')
        target = (root / relative).resolve(strict=True)
        if not target.is_relative_to(root): raise LibraryError('path_escape', 'Pool path escapes root')
        with target.open('rb') as stream: raw = stream.read(MAX_BYTES+1)
        budget -= len(raw)
        if len(raw) > MAX_BYTES or budget < 0: raise LibraryError('size_limit', 'Pool JSON budget exceeded')
        return _record_object(raw.decode('utf-8-sig'))

    if (root / 'index.json').is_file():
        index = read('index.json')
    else:
        from element.io.package import read_package
        entries = []
        for folder in sorted(root.iterdir()):
            if folder.is_dir() and (folder / 'manifest.json').is_file():
                manifest = read_package(folder)
                entries.append({**manifest, 'folder': folder.name,
                    **{key: folder.name + '/' + manifest[key] if manifest.get(key) else None
                       for key in ('component_path', 'element_path', 'structured_path')}})
        index = {'schema_version': '1', 'elements': entries}
    if index.get('schema_version') != '1' or not isinstance(index.get('elements'), list) or len(index['elements']) > 2000:
        raise ValueError('Unsupported or oversized pool index')
    records, diagnostics = [], []
    for entry in index['elements']:
        folder = entry['folder']
        if not isinstance(folder, str) or not folder or folder in ('.', '..') or any(c in folder for c in '/\\:'):
            raise LibraryError('path_escape', 'Pool folder must be a single directory name')
        if entry.get('component_path'):
            from element.io.components import parse_component
            from element.schema.library import ElementDefinition
            if entry['component_path'] != folder + '/component.json':
                raise LibraryError('path_escape', 'Component must belong to its element folder')
            model = parse_component(read(entry['component_path']))
            if (model.name, model.category) != (entry['name'], entry['category']):
                raise ValueError('Package/component identity mismatch')
            definition = ElementDefinition(library_id='templates', element_id=model.id,
                revision=model.revision, name=model.name, category=model.category, origin='template', model=model)
            records.append(native_record(definition, detail={'asset_root': folder,
                'scope': 'Synthetic template; dimensions and behavior are assumed, not manufacturer validated.'}))
            continue
        if entry.get('element_path') and not entry.get('structured_path'):
            if entry['element_path'] != folder + '/element.json':
                raise LibraryError('path_escape', 'Definition must belong to its element folder')
            definition = parse_element(read(entry['element_path']))
            if (definition.name, definition.category) != (entry['name'], entry['category']):
                raise ValueError('Package/definition identity mismatch')
            records.append(native_record(definition, blockers=entry.get('blockers', ()), detail={'asset_root': folder}))
            continue
        if entry['structured_path'] != folder + '/structured.json' or entry.get('element_path') not in (None, folder + '/element.json'):
            raise LibraryError('path_escape', 'Each pool record must retain its own source directory')
        data = read(entry['structured_path'])
        if data.get('record_kind') != 'element_conversion_record' or data.get('conversion_schema_version') != '1':
            raise ValueError('Unsupported structured record')
        if (data['category'], data['name'], data['original_id']) != (entry['category'], entry['name'], entry.get('original_id', entry['folder'])):
            raise ValueError('Pool index/structured identity mismatch')
        TypeAdapter(Category).validate_python(data['category'])
        if (data['model']['id'], data['model']['revision'], data['model']['category']) != (
                data['element_id'], data['revision'], data['category']):
            raise ValueError('Structured/model identity mismatch')
        blockers = tuple(dict.fromkeys((*entry.get('blockers', ()), *data.get('blockers', ()))))
        detail = {'structured_path': entry['structured_path'], 'asset_root': entry['folder'],
            'structured_hash': record_hash(data, 'pool-source-v1'), 'status': data['status'],
            'supplement': data.get('supplement', {}), 'source_manifest': data.get('source_manifest', []),
            'scope': data.get('scope', '')}
        definition = None
        if entry.get('element_path'):
            raw_native = read(entry['element_path'])
            try:
                definition = parse_element(raw_native)
            except ValueError:
                diagnostics.append(entry['folder'] + ': native contract rejected; discovery only')
                blockers += ('Native definition is incompatible with the current element contract.',)
            if definition and (definition.library_id, definition.element_id, definition.revision,
                    definition.name, definition.category) != (data['library_id'], data['element_id'], data['revision'],
                    data['name'], data['category']):
                raise ValueError('Native/structured identity mismatch')
        if definition is not None and not blockers and data['status'] == entry['status'] == 'validated_reference':
            records.append(native_record(definition, detail=detail))
            continue
        model = data['model']
        facts = {}
        for code, raw in model.get('parameters', {}).items():
            parameter = Parameter.model_validate_json(canonical_json(raw))
            evidence = {key: model.get('evidence', {})[key] for key in parameter.evidence_refs
                if key in model.get('evidence', {})}
            source_ids = {e.get('source_ref') for e in evidence.values()}
            sources = {key: value for key, value in model.get('sources', {}).items() if key in source_ids}
            facts[code] = ParameterFact(code=code, status=parameter.status, value=parameter.value,
                minimum=parameter.range.min if parameter.range else None, maximum=parameter.range.max if parameter.range else None,
                conditions=parameter.conditions, evidence=evidence, sources=sources,
                evidence_supported=bool(evidence) and len(evidence) == len(parameter.evidence_refs) and
                    all(e.get('kind') in ('manufacturer_rated', 'measured', 'calculated', 'tutorial_reported') for e in evidence.values()))
        if not blockers: blockers = ('No admitted native element definition is available.',)
        ref = RetrievalRef(library_id=data['library_id'], element_id=data['element_id'], revision=data['revision'],
            content_hash=record_hash({'structured': data, 'index_entry': entry}, 'pool-search-v1'))
        records.append(SearchRecord(ref=ref, name=data['name'], category=data['category'],
            search_text=normalize(' '.join((data['name'], data['element_id'], data.get('product', {}).get('model') or '',
                data['category']))), parameters=facts, blockers=blockers, detail=detail))
    return ElementRetriever(records, diagnostics=diagnostics)
