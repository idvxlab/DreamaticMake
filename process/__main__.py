"""Bounded JSON CLI; no library path, arbitrary code execution or persistence."""
import argparse
import json
import sys
from pydantic import ValidationError
from element.io.load import MAX_BYTES
from process.registry import PROCESSES, get_process


def selectable_elements():
    from element.io.package import pool_root
    from element.library.pool import load_element_pool
    from element.library.mechanical_evidence import mechanical_evidence
    from element.io.records import record_hash
    root = pool_root()
    library = load_element_pool(root)
    rows = []
    for record in library.records:
        if not record.native_ref or record.blockers:
            continue
        if evidence := mechanical_evidence(root, record):
            deferred = [name for name, sensor in getattr(record.definition.model, 'measurements', {}).items()
                        if sensor.sample_period_s is None or sensor.latency_s is None]
            rows.append({'name': record.name, 'category': record.category,
                'element_ref': record.native_ref.model_dump(mode='json'), 'model': record.definition.product.model,
                'origin': record.definition.origin, 'mechanical_evidence': evidence,
                **({'sampling_to_define_in_firmware': deferred} if deferred else {})})
    rows.sort(key=lambda row: (row['mechanical_evidence']['kind'] != 'step', row['name']))
    return {'index_generation': record_hash({'pool': library.generation, 'elements': rows}, 'selection-library-v1'),
            'elements': rows}


def main():
    # JSON wire output is UTF-8 even on Windows consoles using a legacy code page.
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='Typed design process tools')
    parser.add_argument('command', choices=('list', 'schema', 'request', 'validate-output', 'library-pins', 'purchase-candidates'))
    parser.add_argument('kind', nargs='?')
    args = parser.parse_args()
    try:
        if args.command == 'list':
            output = [{'process_kind': k, 'title': get_process(k).title,
                'category': get_process(k).describe().category} for k in PROCESSES]
        elif args.command == 'schema':
            output = get_process(args.kind).describe().model_dump(mode='json')
        elif args.command == 'library-pins':
            output = selectable_elements()
        else:
            data = sys.stdin.buffer.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ValueError('Request exceeds 16 MiB')
            payload = json.loads(data)
            if not isinstance(payload, dict):
                raise ValueError('Request must be a JSON object')
            if args.command == 'purchase-candidates':
                from element.library.procurement import purchase_candidates
                text = payload.get('text')
                if not isinstance(text, str):
                    raise ValueError('Expected hardware source text')
                output = purchase_candidates(text)
            elif args.command == 'validate-output':
                from element.io.records import record_hash
                from process.workflows import SPECS
                deliverable = SPECS[args.kind][1].model_validate_json(json.dumps(payload.get('deliverable'), allow_nan=False))
                if args.kind == 'hardware_selection':
                    library = selectable_elements()
                    expected = payload.get('element_library_generation')
                    if expected is not None and library['index_generation'] != expected:
                        print(json.dumps({'type': 'error', 'code': 'StaleElementLibrary', 'fields': ['element_library_generation']}))
                        return 2
                    from element.schema.library import ElementRef
                    pins = {ElementRef.model_validate(row['element_ref']): row for row in library['elements']}
                    choices = [pins.get(choice.element_ref)
                               for choice in deliverable.choices]
                    unavailable = [f'choices[{n}].element_ref' for n, choice in enumerate(deliverable.choices)
                                   if choices[n] is None]
                    if unavailable:
                        print(json.dumps({'type': 'error', 'code': 'HardwareEvidenceMissing', 'fields': unavailable,
                            'instances': [instance for n, choice in enumerate(deliverable.choices) if choices[n] is None
                                          for instance in choice.instances][:30]}))
                        return 2
                output = {'deliverable': deliverable.model_dump(mode='json')}
                if args.kind == 'hardware_selection':
                    output['mechanical_evidence'] = [{**row, 'instances': choice.instances}
                        for row, choice in zip(choices, deliverable.choices)]
                    output['content_hash'] = record_hash(output, 'hardware-selection-with-evidence-v1')
                else:
                    output['content_hash'] = record_hash(deliverable, 'workflow-deliverable-v1')
            else:
                result = get_process(payload.get('process_kind')).run(payload)
                output = result.model_dump(mode='json')
                print(json.dumps(output, ensure_ascii=False, allow_nan=False))
                return 0 if result.status == 'completed' else 2
        print(json.dumps(output, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, KeyError, OSError) as exc:
        details = exc.errors(include_input=False, include_url=False) if isinstance(exc, ValidationError) else []
        # Do not echo submitted values or executable sources in error responses.
        print(json.dumps({'type': 'error', 'code': type(exc).__name__,
            'message': 'Invalid process request or unavailable input',
            'fields': [str(d['loc']) for d in details]}, ensure_ascii=False))
        return 2


if __name__ == '__main__':
    sys.exit(main())
