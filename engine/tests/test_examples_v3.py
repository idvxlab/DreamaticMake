"""The arm and safe retain their constraints and remain self-contained in v3."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from engine.project_io import load_design_package
from engine.design.professional import joint_positions, resolved_poses, parse_package, Motion
from element.io.records import record_hash


class ExamplesV3Tests(unittest.TestCase):
    def test_portable_examples(self):
        spec = importlib.util.spec_from_file_location('verify_v3', Path('scripts/verify-project-v3.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with patch('element.library.pool.load_element_pool', side_effect=AssertionError('External pool access')):
            for number in (3, 4):
                with self.subTest(project=number): module.verify(Path(f'examples/project_{number}'), tools=False)

    def test_arm_coupling_and_narrowed_limits(self):
        p = load_design_package('examples/project_3')
        for q in (0, .2, .5235987755982988):
            values = joint_positions(p, {'grip/joints/axis':q})
            self.assertAlmostEqual(values['gripper/joints/finger_right'], -q)
        with self.assertRaisesRegex(ValueError, 'follower'):
            resolved_poses(p, {'grip/joints/axis':.2, 'gripper/joints/finger_right':0})
        with self.assertRaisesRegex(ValueError, 'limit'):
            resolved_poses(p, {'yaw/joints/axis':1.3})
        self.assertLess(p.motion.configurations['yaw/joints/axis']['upper'], p.definition('yaw').mechanical.joints['axis'].limit.upper)

    def test_invalid_constraints_rejected(self):
        original = load_design_package('examples/project_3').model_dump(mode='json')
        for change, message in (
            (lambda m: m['configurations']['yaw/joints/axis'].update(upper=10), 'exceeds'),
            (lambda m: m['couplings']['gripper/mirror'].update(factor=0), 'factor'),
            (lambda m: m['couplings'].update(reverse={'driver':'gripper/joints/finger_right','follower':'grip/joints/axis','factor':-1}), 'cycle'),
        ):
            data = copy.deepcopy(original)
            change(data['motion'])
            record = Motion.model_validate_json(__import__('json').dumps(data['motion']))
            data['manifest']['record_pins']['motion']['content_hash'] = record_hash(record, 'design-record-v3')
            with self.assertRaisesRegex(ValueError, message): resolved_poses(parse_package(data))
