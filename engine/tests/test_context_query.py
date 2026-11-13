import json
import shutil
import tempfile
import unittest
from pathlib import Path
from engine.query import QueryService, QueryRequest, Selector, Budget
from engine.candidate import build_candidate, CandidateProposal, SetPlacement, SetJointInitial
from engine.project_io import load_design_package
from element.base.frame import Pose


class ContextQueryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = QueryService('examples/project_2', 'clock')

    def query(self, method, **kwargs):
        return self.service.query(QueryRequest(request_id='test', project_handle='clock',
            snapshot_id=self.service.package.snapshot_id, method=method, **kwargs))

    def test_determinism_scope_and_version(self):
        a = self.query('project.overview')
        self.assertEqual(a, self.query('project.overview'))
        with self.assertRaises(ValueError): self.service.query({'request_id': 'bad', 'project_handle': 'clock', 'snapshot_id': '0'*64, 'method': 'project.overview'})
        with self.assertRaises(ValueError): self.query('instances.inspect', selector=Selector(instances=('old/body/ref',)))

    def test_shared_definition_and_atomic_budget(self):
        p = self.service.package
        groups = {}
        for i, instance in p.index.instances.items(): groups.setdefault(instance.element_ref.content_hash, []).append(i)
        ids = next(v for v in groups.values() if len(v)>1)
        result = self.query('elements.inspect', selector=Selector(instances=tuple(ids)), budget=Budget(max_text_tokens=32000))
        self.assertEqual(len(result.data), 1)
        self.assertEqual(set(result.data[0]['instances']), set(ids))
        small = self.query('circuit.inspect', budget=Budget(max_text_tokens=128))
        self.assertEqual(small.completeness, 'needs_narrower_scope')
        self.assertFalse(small.data)
        self.assertFalse(small.boundary)

    def test_document_allowlist_and_no_fake_observation(self):
        for name in ('.env', '../project.json', 'doc/unregistered.md'):
            with self.assertRaises(ValueError): self.query('documents.read', selector=Selector(source_id=name))
        result = self.query('documents.list', budget=Budget(max_text_tokens=32000))
        self.assertTrue(all(d['currency'] in ('current','historical','unresolved') for d in result.data))
        evidence = self.query('evidence.query')
        self.assertFalse(evidence.data)
        self.assertTrue(evidence.unknowns)

    def test_candidate_scope_stale_documents_and_roundtrip(self):
        workspace = Path('workspace/tests'); workspace.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=workspace) as tmp:
            root = Path(tmp)/'source'; shutil.copytree('examples/project_2', root)
            service = QueryService(root, 'clock'); p = service.package
            target, pose = next(iter(p.structure.root_placements.items()))
            proposal = CandidateProposal(base_snapshot_id=p.snapshot_id, source_manifest_id=service.source_manifest(),
                operations=(SetPlacement(target=target, pose=Pose(translation_m=(.001, 0., 0.))),))
            with self.assertRaises(ValueError): build_candidate(root, Path(tmp)/'bad', proposal, write_targets=())
            receipt = build_candidate(root, Path(tmp)/'candidate', proposal, write_targets=(target,))
            self.assertNotEqual(receipt['candidate_snapshot_id'], p.snapshot_id)
            self.assertEqual(load_design_package(root).snapshot_id, p.snapshot_id)
            self.assertEqual(load_design_package(Path(tmp)/'candidate').structure.revision, p.structure.revision+1)
            doc = root/'doc/requirements/README.md'; doc.write_text(doc.read_text(encoding='utf-8')+'\nchanged', encoding='utf-8')
            self.assertEqual(load_design_package(root).snapshot_id, p.snapshot_id)
            with self.assertRaisesRegex(ValueError, 'Stale'): build_candidate(root, Path(tmp)/'stale', proposal, write_targets=(target,))

    def test_full_circuit_boundary(self):
        result = self.query('circuit.inspect', selector=Selector(instances=('button_stop',)), budget=Budget(max_text_tokens=32000))
        self.assertNotEqual(result.completeness, 'needs_narrower_scope')
        self.assertEqual(len(result.boundary[0]['nets']), len(self.service.package.circuit_logic.nets))

    def test_local_joint_candidate_limit_and_complete_following(self):
        from engine.design.professional import resolved_poses
        workspace = Path('workspace/tests'); workspace.mkdir(parents=True, exist_ok=True)
        service = self.service; p = service.package
        with tempfile.TemporaryDirectory(dir=workspace) as tmp:
            def proposal(position):
                return CandidateProposal(base_snapshot_id=p.snapshot_id, source_manifest_id=service.source_manifest(),
                    operations=(SetJointInitial(target='button_stop/joints/press', position=position),))
            with self.assertRaises(ValueError): build_candidate(service.root, Path(tmp)/'bad', proposal(1.), write_targets=('button_stop/joints/press',))
            receipt = build_candidate(service.root, Path(tmp)/'candidate', proposal(.0002), write_targets=('button_stop/joints/press',))
            candidate = load_design_package(Path(tmp)/'candidate')
            saved = json.loads((Path(tmp)/'candidate/design/motion.json').read_text(encoding='utf-8'))
            self.assertIsInstance(saved['joints']['mount/case_rear']['parent'], str)
            self.assertNotIn('child_origin', saved['joints']['mount/case_rear'])
            self.assertEqual(candidate.motion.revision, p.motion.revision+1)
            old, new = resolved_poses(p), resolved_poses(candidate)
            self.assertNotEqual(old['button_stop/cap/links/body'], new['button_stop/cap/links/body'])
            self.assertEqual(old['case_front/links/body'], new['case_front/links/body'])
            self.assertEqual(receipt['outcome'], 'draft')
