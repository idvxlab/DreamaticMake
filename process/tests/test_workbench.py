import json
import subprocess
import sys
import unittest

from pydantic import ValidationError
from process.artifacts import LogicalLayoutOutput, MotionDetailOutput, SpatialLayoutOutput
from process.workbench import SPECS, describe_stage


class WorkbenchTests(unittest.TestCase):
    def test_all_stage_schemas_use_native_contracts(self):
        self.assertEqual(len(SPECS), 11)
        for stage in SPECS:
            descriptor = describe_stage(stage)
            self.assertEqual(descriptor['contract_version'], 'workbench-stage/3')
            for definition in descriptor['output_schema'].get('$defs', {}).values():
                self.assertNotIn('record_id', definition.get('properties', {}) if
                                 'object_id' in definition.get('properties', {}) else {})
        result = subprocess.run([sys.executable, '-B', '-m', 'process', 'schema', 'spatial_layout'],
                                capture_output=True, encoding='utf-8', timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('OccurrenceRef', json.loads(result.stdout)['output_schema']['$defs'])

    def test_scoped_link_and_electrical_endpoints(self):
        link = {'instance': 'button', 'unit_path': ['guide'], 'domain': 'mechanical',
                'collection': 'links', 'id': 'body'}
        layout = SpatialLayoutOutput.model_validate_json(json.dumps({
            'placements': [{'instance_ref': link, 'world_pose': {}}]}))
        self.assertEqual(layout.placements[0].instance_ref.unit_path, ('guide',))
        circuit = LogicalLayoutOutput.model_validate_json(json.dumps({'nets': {
            'signal': {'name': 'signal', 'nodes': ['controller/io', 'button/contact']}}}))
        self.assertEqual(circuit.nets['signal'].nodes[0].collection, 'pins')
        with self.assertRaises(ValidationError):
            SpatialLayoutOutput.model_validate_json(json.dumps({'placements': [{
                'instance_ref': {'record_id': 'old', 'collection': 'instances', 'object_id': 'a'},
                'world_pose': {}}]}))

    def test_moving_joint_requires_native_limits_and_initial_position(self):
        joint = {'type': 'prismatic', 'parent': 'base/body', 'child': 'button/body',
                 'axis': [0, 0, 1], 'limit': {'lower': 0, 'upper': 0.01}}
        with self.assertRaises(ValidationError):
            MotionDetailOutput.model_validate_json(json.dumps({'joints': {'press': joint}}))
        result = MotionDetailOutput.model_validate_json(json.dumps({
            'joints': {'press': joint}, 'initial_positions': {'press': 0}}))
        self.assertEqual(result.joints['press'].limit.upper, 0.01)


if __name__ == '__main__':
    unittest.main()
