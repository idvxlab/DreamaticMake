import tempfile
import unittest
from pathlib import Path
from harness.storage import VersionStore
from engine.query import QueryService
from engine.candidate import CandidateProposal, SetPlacement, build_candidate
from element.base.frame import Pose


class StoreTests(unittest.TestCase):
    def test_fault_recovery_stale_commit_and_complete_version(self):
        workspace = Path('workspace/tests'); workspace.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=workspace) as tmp:
            source = QueryService('examples/project_2', 'clock'); p = source.package
            target = next(iter(p.structure.root_placements))
            proposal = CandidateProposal(base_snapshot_id=p.snapshot_id, source_manifest_id=source.source_manifest(),
                operations=(SetPlacement(target=target, pose=Pose(translation_m=(.001, 0., 0.))),))
            candidate = Path(tmp)/'candidate'
            build_candidate(source.root, candidate, proposal, write_targets=(target,))
            store = VersionStore(Path(tmp)/'store', source.root)
            def fail_at(point):
                def fail(actual):
                    if actual == point: raise RuntimeError('injected interruption')
                return fail
            baseline = dict(base_snapshot_id=p.snapshot_id, source_manifest_id=source.source_manifest())
            with self.assertRaises(RuntimeError): store.commit_draft(candidate, **baseline, fault=fail_at('prepared'))
            self.assertEqual(store.recover()['state'], 'abandoned')
            self.assertEqual(store.current_root(), source.root)
            with self.assertRaises(RuntimeError): store.commit_draft(candidate, **baseline, fault=fail_at('pointer_switched'))
            recovered = store.recover()
            self.assertEqual(recovered['state'], 'committed')
            self.assertEqual(QueryService(store.current_root(), 'clock').package.snapshot_id, recovered['snapshot_id'])
            with self.assertRaisesRegex(ValueError, 'Stale'): store.commit_draft(candidate, **baseline)
