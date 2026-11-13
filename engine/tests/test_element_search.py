import json
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
from element.tests.test_retrieval import pool_fixture
from element.library.pool import load_element_pool
from engine.element_search import ElementSearchTool


class ElementToolTests(unittest.TestCase):
    def test_host_injection_and_tools_are_read_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pool_fixture(root)
            tool = ElementSearchTool(load_element_pool(root))
            self.assertEqual(len(tool.describe()['tools']), 3)
            result = tool.call('element_search', {})
            detail = tool.call('element_inspect', result['items'][0]['ref'])
            self.assertTrue(detail['definition'])
            self.assertEqual(sum(c['count'] for c in tool.call('element_categories', {})['categories']), 1)
            for name in ('approve', 'publish', 'exec'):
                with self.assertRaises(ValueError): tool.call(name, {})
            self.assertFalse((root/'index.sqlite3').exists())

    def test_engine_json_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            pool_fixture(Path(tmp))
            request = {'request_id': 'search', 'method': 'element_search', 'arguments': {}}
            result = subprocess.run([sys.executable, '-B', '-m', 'engine', 'request', '--element-pool', tmp],
                input=json.dumps(request), text=True, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(json.loads(result.stdout)['payload']['total'], 1)
            request['arguments']['root'] = tmp
            invalid = subprocess.run([sys.executable, '-B', '-m', 'engine', 'request', '--element-pool', tmp],
                input=json.dumps(request), text=True, capture_output=True, timeout=30)
            self.assertEqual(invalid.returncode, 2)


if __name__ == '__main__': unittest.main()
