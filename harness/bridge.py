"""Bounded stdio task service; dependency direction remains harness -> process -> engine."""
import argparse
import json
import sys
from element.io.load import MAX_BYTES, _unique, _nonfinite
from engine.query import QueryService
from engine.tools.source import project_context
from process.tasks import TaskSpec, prepare_task, validate_deliverable


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['request'])
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--project-handle', required=True)
    args = parser.parse_args()
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES+1)
        if len(raw) > MAX_BYTES: raise ValueError('Request budget exceeded')
        request = json.loads(raw, object_pairs_hook=_unique, parse_constant=_nonfinite)
        if set(request) != {'request_id', 'method', 'arguments'}: raise ValueError('Unexpected envelope fields')
        if request['method'] not in ('task-prepare', 'task-validate'): raise ValueError('Unsupported task method')
        service = QueryService(args.project_root, args.project_handle, evidence_context=project_context(args.project_root))
        arguments = request['arguments']
        allowed = {'task'} if request['method'] == 'task-prepare' else {'task', 'result', 'attempt_id'}
        if set(arguments) != allowed: raise ValueError('Unexpected task arguments')
        task = TaskSpec.model_validate_json(json.dumps(arguments['task']))
        if task.project_handle != args.project_handle: raise ValueError('Task project binding differs')
        context = prepare_task(task, service)
        payload = context if request['method'] == 'task-prepare' else validate_deliverable(
            task, arguments['result'], context, arguments['attempt_id']).model_dump(mode='json')
        print(json.dumps({'type': 'result', 'payload': payload}))
        return 0
    except (ValueError, TypeError, KeyError, OSError):
        # Never echo arbitrary result text, source bytes or credential-bearing exception values.
        print(json.dumps({'type': 'error', 'diagnostics': [{'message': 'Task request failed validation or baseline checks'}]}))
        return 2


if __name__ == '__main__': raise SystemExit(main())
