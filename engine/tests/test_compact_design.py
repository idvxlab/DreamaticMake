"""Compact project source preserves pinned execution inputs and validation."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from element.io.records import record_hash
from element.schema.professional import Joint
from engine.design.authoring import compact_record
from engine.design.professional import (Electrical, Motion, Structure, parse_package,
                                        project_views, resolved_poses)
from engine.execution import run_check
from engine.project_io import load_design_package, load_project
from engine.tools import ToolRequest, prepare
from engine.tools.source import project_context


ROOT = Path('examples/project_2')


class CompactDesignTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package = load_design_package(ROOT)

    def test_all_domain_records_roundtrip_without_repinning(self):
        expanded = self.package.model_dump(mode='json')
        compact = copy.deepcopy(expanded)
        for field in ('structure', 'motion', 'circuit_logic', 'logic'):
            compact[field] = compact_record(getattr(self.package, field))
        restored = parse_package(compact)
        self.assertEqual(restored.model_dump(mode='json'), expanded)
        self.assertEqual(restored.snapshot_id, self.package.snapshot_id)
        self.assertEqual(project_views(restored), project_views(self.package))
        self.assertEqual(load_project(ROOT)['project_version'], 2)

    def test_defaults_and_contextual_references(self):
        motion = Motion.model_validate_json(json.dumps({'record_id': 'motion', 'joints': {
            'mount': {'parent': 'base/body', 'child': 'arm/body'},
            'press': {'type': 'prismatic', 'parent': 'arm/body', 'child': 'key/body',
                      'axis': [0, 0, -1], 'limit': {'lower': 0, 'upper': .0004},
                      'child_origin': {'translation_m': [.01, 0, 0]}}}}))
        fixed, press = motion.joints['mount'], motion.joints['press']
        self.assertEqual(fixed.type, 'fixed')
        self.assertEqual(fixed.parent.domain, 'mechanical')
        self.assertEqual(fixed.origin.rotation_xyzw, (0, 0, 0, 1))
        self.assertEqual(press.child_origin.translation_m, (.01, 0, 0))
        self.assertIsNone(press.limit.velocity)
        self.assertEqual(motion.initial_positions, {})  # Never invent motion state.
        self.assertEqual(compact_record(motion)['joints']['press']['type'], 'prismatic')
        # The reusable element contract still requires an explicit joint type.
        with self.assertRaises(ValueError):
            Joint.model_validate_json(json.dumps({'parent': fixed.parent.model_dump(mode='json'),
                                                  'child': fixed.child.model_dump(mode='json')}))

    def test_metadata_defaults_and_unconnected_groups_expand(self):
        structure = Structure.model_validate_json(json.dumps({'record_id': 'structure',
            'mount_defaults': {'hardware': 'M2', 'status': 'unverified'},
            'mount_connections': {'one': {'a': 'a/hole', 'b': 'b/hole'},
                                  'two': {'a': 'a/other', 'b': 'c/hole', 'hardware': 'M3'}}}))
        self.assertEqual(structure.mount_connections['one']['hardware'], 'M2')
        self.assertEqual(structure.mount_connections['two']['hardware'], 'M3')
        self.assertNotIn('datum_position_mismatch_m', structure.mount_connections['one'])
        self.assertNotIn('mount_defaults', structure.model_dump(mode='json'))
        electrical = Electrical.model_validate_json(json.dumps({'record_id': 'electrical',
            'nets': {'supply': {'kind': 'power', 'nodes': ['a/vcc', 'b/vcc']},
                     'gnd': {'name': 'Ground', 'kind': 'ground', 'nodes': ['a/gnd', 'b/gnd']}},
            'unconnected': [{'pins': ['a/spare', 'b/spare'], 'intentional': True, 'reason': 'Reserved'}]}))
        self.assertEqual(electrical.nets['supply'].name, 'supply')
        self.assertEqual(electrical.nets['gnd'].name, 'Ground')
        self.assertEqual(len(electrical.unconnected), 2)
        self.assertEqual(electrical.unconnected[1]['pin']['id'], 'spare')
        self.assertEqual(electrical.unconnected[1]['reason'], 'Reserved')

    def test_invalid_compact_inputs_are_not_silently_repaired(self):
        for joint in (
            {'parent': 'a/body/extra', 'child': 'b/body'},
            {'parent': 'a/body', 'child': 'b/body', 'type': 'revolute'},
            {'parent': 'a/body', 'child': 'b/body', 'axis': [0, 0, 1]},
            {'parent': 'a/body', 'child': 'b/body', 'type': 'prismatic', 'axis': [0, 0, 2]},
        ):
            with self.subTest(joint=joint), self.assertRaises(ValueError):
                Motion.model_validate_json(json.dumps({'record_id': 'motion', 'joints': {'j': joint}}))
        with self.assertRaises(ValueError):
            Structure.model_validate_json(json.dumps({'record_id': 'structure',
                'mount_defaults': {'datum_position_mismatch_m': 0}}))
        for bad in ({'pins': [], 'reason': 'x'}, {'pins': ['a/spare'], 'pin': 'a/spare'}):
            with self.subTest(unconnected=bad), self.assertRaises(ValueError):
                Electrical.model_validate_json(json.dumps({'record_id': 'electrical', 'unconnected': [bad]}))
        data = self.package.model_dump(mode='json')
        data['motion'] = compact_record(self.package.motion)
        data['motion']['joints']['press/plus']['limit']['upper'] = .001
        with self.assertRaisesRegex(ValueError, 'pin'):
            parse_package(data)
        # A valid new pin cannot hide an unresolved short reference.
        data['motion']['joints']['press/plus']['child'] = 'missing/body'
        data['manifest']['record_pins']['motion']['content_hash'] = record_hash(
            Motion.model_validate_json(json.dumps(data['motion'])), 'design-record-v3')
        with self.assertRaisesRegex(ValueError, 'Unresolved'):
            parse_package(data)

    def test_tool_preparation_matches_expanded_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            context = project_context(ROOT, workspace=tmp)
            expanded = parse_package(self.package.model_dump(mode='json'))
            from dataclasses import replace
            other = replace(context, source=expanded)
            profiles = json.loads((ROOT/'analysis/tools.json').read_text(encoding='utf-8'))['profiles']
            for profile in profiles:
                request = ToolRequest(request_id='compact-equivalence', tool_id=profile['tool_id'],
                    operation=profile['operation'], snapshot_id=self.package.snapshot_id,
                    source_kind='design_v3', options=profile['options'], scope=tuple(profile.get('scope', ())))
                compact_job, expanded_job = prepare(request, context), prepare(request, other)
                self.assertEqual(compact_job.status, expanded_job.status)
                self.assertEqual(compact_job.tool_input, expanded_job.tool_input)
                self.assertEqual(compact_job.source_map, expanded_job.source_map)
                self.assertEqual(compact_job.dependency_manifest, expanded_job.dependency_manifest)
        self.assertEqual(run_check(self.package, 'electrical_rules').outcome, 'pass')
        # All five moving keys, including the child-anchor transform, retain FK.
        for value in (0, .0002, .0004):
            states = {id: value for id, j in self.package.effective_joints().items() if j.type == 'prismatic'}
            self.assertEqual(resolved_poses(self.package, states), resolved_poses(expanded, states))


if __name__ == '__main__':
    unittest.main()
