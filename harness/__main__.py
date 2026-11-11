"""Prepare a bounded F0 task without model access or any authoring writes."""
import argparse
import json
import uuid
from pathlib import Path
from engine.query import QueryService
from process.tasks import plan_tasks, prepare_task, describe_task
from engine.tools.source import project_context


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project')
    parser.add_argument('--instance', action='append', required=True)
    parser.add_argument('--handle', default='project')
    args = parser.parse_args()
    service = QueryService(args.project, args.handle, evidence_context=project_context(args.project))
    task = plan_tasks(service, args.instance)[0]
    context = prepare_task(task, service)
    directory = Path(__file__).resolve().parents[1] / 'workspace/harness' / service.package.manifest.id / uuid.uuid4().hex
    directory.mkdir(parents=True)
    for name, value in (('task.json', task.model_dump(mode='json')), ('context.json', context),
                        ('contracts.json', describe_task(task.kind))):
        (directory/name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'directory': str(directory), 'ready': context['ready'],
                      'queries': [{'method': q['schema_ref'], 'completeness': q['completeness']} for q in context['queries']],
                      'model_called': False, 'engineering_outcome': 'unverified'}))


if __name__ == '__main__': main()
