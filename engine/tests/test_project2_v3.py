"""The active project remains portable after removing retired migration inputs."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


class Project2Tests(unittest.TestCase):
    def test_native_project_without_external_pool(self):
        spec = importlib.util.spec_from_file_location('verify_project2', Path('scripts/verify-project2-v3.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with patch('element.library.pool.load_element_pool', side_effect=AssertionError('External pool access')):
            result = module.verify(Path('examples/project_2'), tools=False)
        self.assertEqual(result['pose_samples'], 18)
        self.assertEqual(result['top_level_instances'], 18)
        self.assertEqual(result['bom_quantity'], 38)
