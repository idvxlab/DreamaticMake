"""The migrated clock remains portable and preserves its versioned engineering baseline."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


class Project2MigrationTests(unittest.TestCase):
    def test_native_project_without_external_pool(self):
        spec=importlib.util.spec_from_file_location('verify_project2',Path('scripts/verify-project2-v3.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with patch('element.library.pool.load_element_pool',side_effect=AssertionError('Unexpected external pool access')):
            evidence=module.verify(Path('examples/project_2'),tools=False)
        self.assertEqual(evidence['pose_samples'],18)
        self.assertEqual(evidence['max_translation_error_m'],0.)
        self.assertEqual(evidence['max_quaternion_error'],0.)


if __name__=='__main__':unittest.main()
