"""Only trusted registry modules and operations may execute in this worker."""
import importlib
import json
from pathlib import Path
import sys
from .registry import TOOLS, versions


def main():
    output = Path(sys.argv[2])
    try:
        path = Path(sys.argv[1])
        if path.stat().st_size > 64_000_000: raise ValueError('Input budget exceeded')
        request = json.loads(path.read_text(encoding='utf-8'))
        tool, operation = request['tool_id'], request['operation']
        if tool not in TOOLS or operation not in (*TOOLS[tool][2], 'probe'): raise ValueError('Unregistered operation')
        backend = importlib.import_module(TOOLS[tool][3])
        actual = {**versions(tool), **backend.probe()}
        value = {'versions': actual} if operation == 'probe' else {**backend.execute(operation, request['input']), 'versions': actual}
        output.write_text(json.dumps(value, allow_nan=False), encoding='utf-8')
        return 0
    except Exception as error:
        output.write_text(json.dumps({'error': str(error)}), encoding='utf-8')
        return 2


if __name__ == '__main__': raise SystemExit(main())
