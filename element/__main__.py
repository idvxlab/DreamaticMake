"""Explicit local library CLI; importing elements never touches the filesystem."""
import argparse
import json
import sys
from element.io.load import _record_object, MAX_BYTES
from element.io.records import export_schema, parse_element, element_ref
from element.library import ElementLibrary

def main(argv=None):
    parser = argparse.ArgumentParser(description='Reusable element library')
    parser.add_argument('method', choices=['schema', 'validate', 'publish', 'get', 'search', 'rebuild-index', 'seed'])
    parser.add_argument('input', nargs='?')
    parser.add_argument('--root')
    args = parser.parse_args(argv)
    try:
        if args.method == 'schema': result = export_schema(args.input or 'element_definition')
        else:
            if args.method in ('rebuild-index', 'seed'): data = None
            else:
                if args.input:
                    with open(args.input, 'rb') as stream: raw = stream.read(MAX_BYTES+1)
                else: raw = sys.stdin.buffer.read(MAX_BYTES+1)
                if len(raw) > MAX_BYTES: raise ValueError('Input exceeds size limit')
                data = _record_object(raw.decode('utf-8'))
            if args.method == 'validate': result = element_ref(parse_element(data))
            else:
                if not args.root: raise ValueError('Library operations require --root')
                library = ElementLibrary(args.root)
                if args.method == 'seed':
                    if not args.input: raise ValueError('seed requires an explicit template directory')
                    from pathlib import Path
                    from element.io.components import load_component
                    from element.schema.library import ElementDefinition
                    definitions = []
                    for path in sorted(Path(args.input).glob('*.json')):
                        if path.name.endswith('.scenario.json'): continue
                        model = load_component(path)
                        definitions.append(ElementDefinition(library_id='templates', element_id=model.id,
                            revision=model.revision, name=model.name, category=model.category, origin='template', model=model))
                    refs = [library.publish(d).model_dump(mode='json') for d in definitions]
                    result = {'published': len(refs), 'refs': refs}
                else:
                    result = {'publish': library.publish, 'get': library.get, 'search': library.search,
                              'rebuild-index': lambda _: library.rebuild_index()}[args.method](data)
        if hasattr(result, 'model_dump'): result = result.model_dump(mode='json')
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, OSError) as exc:
        print(json.dumps({'error': getattr(exc, 'code', 'invalid_input'), 'message': str(exc)}, ensure_ascii=False))
        return 2

if __name__ == '__main__': raise SystemExit(main())
