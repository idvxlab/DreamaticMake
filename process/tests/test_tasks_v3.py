import unittest
import json
import shutil
import tempfile
import importlib.util
from pathlib import Path
from process.tasks import TaskSpec, prepare_task, validate_deliverable, integrate_deliverable, TaskResult
from engine.query import QueryService, Budget


class TaskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.service = QueryService('examples/project_2', 'clock')

    def task(self, **kw):
        return TaskSpec(task_id='F0', kind='collision.classify', project_handle='clock',
            base_snapshot_id=self.service.package.snapshot_id, source_manifest_id=self.service.source_manifest(),
            instances=('button_stop',), budget=Budget(max_text_tokens=32000), **kw)

    def test_identity_sources_and_model_status(self):
        task = self.task(); ctx = prepare_task(task, self.service)
        base = dict(task_id='F0', attempt_id='attempt-1', context_manifest_id=ctx['context_manifest_id'], status='needs_input')
        self.assertEqual(validate_deliverable(task, base, ctx, 'attempt-1').status, 'needs_input')
        with self.assertRaises(ValueError): validate_deliverable(task, {**base, 'status':'approved'}, ctx, 'attempt-1')
        with self.assertRaises(ValueError): validate_deliverable(task, {**base, 'attempt_id':'old'}, ctx, 'attempt-1')
        with self.assertRaises(ValueError): validate_deliverable(task, {**base, 'evidence_refs':['fake']}, ctx, 'attempt-1')
        with self.assertRaises(ValueError): integrate_deliverable(task, base, ctx, 'attempt-1')

    def test_readonly_and_source_forgery(self):
        task = self.task(); ctx = prepare_task(task, self.service)
        base = dict(task_id='F0', attempt_id='a', context_manifest_id=ctx['context_manifest_id'], status='proposed')
        with self.assertRaises(ValueError): validate_deliverable(task, {**base, 'operations':[{'target':'x', 'pose':{}}]}, ctx, 'a')
        with self.assertRaises(ValueError): validate_deliverable(task, {**base, 'findings':[{'owner':'button_stop', 'classification':'unknown', 'rationale':'Missing real stroke', 'source_ids':['fake']}]}, ctx, 'a')

    def test_project_documents_are_delivered_without_legacy_workflows(self):
        ctx = prepare_task(self.task(), self.service)
        self.assertTrue(ctx['ready'])
        sources = {s['source_id'] for q in ctx['queries'] for s in q['sources']}
        self.assertIn('doc/requirements/README.md', sources)
        self.assertIn('doc/assembly_detail/README.md', sources)
        self.assertTrue(any(row.get('text') for q in ctx['queries'] if q['schema_ref']=='documents.read/1' for row in q['data']))
        self.assertIsNone(importlib.util.find_spec('process._workflow'))
        self.assertIsNone(importlib.util.find_spec('engine.design.store'))

    def test_reference_plan_edits_invalidate_task_and_unregistered_sources_fail(self):
        workspace=Path('workspace/tests'); workspace.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=workspace) as tmp:
            root=Path(tmp)/'project'; shutil.copytree(self.service.root, root)
            service=QueryService(root,'clock')
            task=TaskSpec(task_id='F0',kind='collision.classify',project_handle='clock',
                base_snapshot_id=service.package.snapshot_id,source_manifest_id=service.source_manifest(),
                instances=('button_stop',))
            path=root/'doc/tasks/index.json'; data=json.loads(path.read_text(encoding='utf-8'))
            data['tasks']['collision.classify']['references'][0]['source_id']='../project.json'
            path.write_text(json.dumps(data),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'Stale'): prepare_task(task,service)
            task=TaskSpec.model_validate_json(json.dumps({**task.model_dump(mode='json'),'source_manifest_id':service.source_manifest()}))
            with self.assertRaisesRegex(ValueError,'Unregistered'): prepare_task(task,service)
