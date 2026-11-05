import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from element.tests.test_library import fixture
from engine.design import make_package, parse_package
from engine.design.contracts import KINDS
from engine.design.io import record_ref, snapshot_id
from engine.design.selection import instantiate_element
from engine.design.dispatch import dispatch_design
from engine.language import to_document, to_markdown


class EngineLanguageTests(unittest.TestCase):
    def package(self):
        return make_package(design_id='demo', title='测试设计', records=[{
            'kind': kind, 'design_id': 'demo', 'record_id': kind,
            'title': kind, 'data': {},
        } for kind in KINDS])

    def test_eight_layers_and_hashes_without_execution(self):
        package = self.package()
        before = package.model_dump_json()
        with patch('engine.compiler.lower.compile_model', side_effect=AssertionError('must not compile')):
            text = to_markdown(package)
        for kind in KINDS:
            self.assertIn(' · ' + kind, text)
        self.assertIn(snapshot_id(package.manifest), text)
        for record in package.records: self.assertIn(record_ref(record).content_hash, text)
        self.assertEqual(before, package.model_dump_json())
        self.assertEqual(text, to_markdown(before))
        self.assertEqual(text, dispatch_design('design_language', {'design': package})['markdown'])

    def test_pinned_elements_retained_once_without_occurrence_copies(self):
        package = parse_package(instantiate_element(fixture(), design_id='demo')['package'])
        text = to_markdown(package)
        self.assertIn('demo/housing@1', text)
        self.assertIn('size\\_m', text)
        self.assertIn('Test fixture only', text)
        self.assertNotIn('resolved_records', text)
        changed = package.model_dump(mode='json')
        changed['records'][0]['title'] = 'Tampered'
        with self.assertRaisesRegex(ValueError, 'pin/hash'): to_markdown(changed)

    def test_incomplete_references_and_empty_layers_remain_visible(self):
        package = make_package(design_id='demo', title='Incomplete', records=[{
            'kind': 'function', 'design_id': 'demo', 'record_id': 'goal', 'title': 'Goal',
            'data': {'realizations': [{'record_id': 'missing'}]},
        }])
        text = to_markdown(package)
        self.assertIn('reference\\.unresolved', text)
        self.assertIn('missing', text)
        self.assertIn('未声明记录。', text)
        self.assertIn('goal', to_markdown(package.records[0]))
        self.assertIn(snapshot_id(package.manifest), to_markdown(package.manifest))

    def test_legacy_project_bundle_and_draft_keep_native_data(self):
        for filename in ('gripper.project.json', 'actuator.bundle.json'):
            source = Path('engine/tests/fixtures/data', filename).read_text(encoding='utf-8')
            text = to_markdown(source)
            self.assertTrue(text.startswith('# 设计'))
            self.assertNotIn('```json', text)
        self.assertIn('entities', to_markdown({'record_kind': 'layout_draft', 'entities': {'part': {'name': 'Part'}}}))
        bad = json.loads(Path('engine/tests/fixtures/data/gripper.project.json').read_text(encoding='utf-8'))
        bad['components']['gripper']['unknown'] = True
        with self.assertRaises(ValueError): to_markdown(bad)

    def test_cli_and_request_envelopes(self):
        env = {**os.environ, 'PYTHONIOENCODING': 'utf-8'}
        package = self.package()
        for method in ('language', 'design_language'):
            request = {'request_id': 'md-test', 'method': method,
                       'source' if method == 'language' else 'design': package.model_dump(mode='json')}
            result = subprocess.run([sys.executable, '-B', '-m', 'engine', 'request'],
                                    input=json.dumps(request), capture_output=True, text=True, encoding='utf-8', env=env)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            output = json.loads(result.stdout)
            self.assertEqual(output['request_id'], 'md-test')
            self.assertEqual(output['payload'], to_document(package))
        result = subprocess.run([sys.executable, '-B', '-m', 'engine', 'language'],
                                input=package.model_dump_json(), capture_output=True, text=True, encoding='utf-8', env=env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(result.stdout, to_markdown(package))
        result = subprocess.run([sys.executable, '-B', '-m', 'engine', 'language', 'engine/tests/fixtures/data/gripper.project.json'],
                                capture_output=True, text=True, encoding='utf-8', env=env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertTrue(result.stdout.startswith('# 设计项目'))


if __name__ == '__main__': unittest.main()
