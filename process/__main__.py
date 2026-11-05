"""Bounded JSON CLI; no library path, arbitrary code execution or persistence."""
import argparse
import json
import sys
from pydantic import ValidationError
from element.io.load import MAX_BYTES
from process.registry import PROCESSES, get_process


def main():
    # JSON wire output is UTF-8 even on Windows consoles using a legacy code page.
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='Typed design process tools')
    parser.add_argument('command', choices=('list', 'schema', 'request'))
    parser.add_argument('kind', nargs='?')
    args = parser.parse_args()
    try:
        if args.command == 'list':
            output = [{'process_kind': k, 'title': get_process(k).title,
                'category': get_process(k).describe().category} for k in PROCESSES]
        elif args.command == 'schema':
            output = get_process(args.kind).describe().model_dump(mode='json')
        else:
            data = sys.stdin.buffer.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ValueError('Request exceeds 16 MiB')
            payload = json.loads(data)
            if not isinstance(payload, dict):
                raise ValueError('Request must be a JSON object')
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
