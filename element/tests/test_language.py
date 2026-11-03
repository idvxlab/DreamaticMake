import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from element.io.components import load_component
from element.io.records import element_ref
from element.language import LANGUAGE_VERSION, to_document, to_markdown
from element.language._markdown import Document
from element.tests.test_library import fixture


class ElementLanguageTests(unittest.TestCase):
    def test_definition_preserves_pin_units_evidence_and_native_geometry(self):
        definition = fixture()
        before = definition.model_dump_json()
        text = to_markdown(definition)
        self.assertTrue(text.startswith('# 零件 · 风机壳体\n'))
        for value in (element_ref(definition).content_hash, '100.0', '"mm"',
                      'measurement', 'Test fixture only', 'size\\_m', '0.1', LANGUAGE_VERSION):
            self.assertIn(value, text)
        self.assertNotIn('```json', text)
        self.assertEqual(before, definition.model_dump_json())
        self.assertEqual(text, to_markdown(json.loads(before)))
        self.assertEqual(text, to_markdown(before))
        self.assertEqual(to_document(definition)['markdown'], text)

    def test_all_category_examples_render_without_lowering(self):
        categories = set()
        for path in Path('examples/element').glob('*'):
            if path.suffix not in ('.json', '.toml') or path.name.endswith('.scenario.json'):
                continue
            model = load_component(path)
            categories.add(model.category)
            with self.subTest(path=path):
                text = to_markdown(model)
                self.assertIn('component_design', text)
                for key in model.model_dump(mode='json'):
                    # Every serialized root field has a heading or field label.
                    self.assertIn(key.replace('_', r'\_'), text)
        self.assertEqual(len(categories), 14)

    def test_markdown_content_cannot_break_document_structure(self):
        source = fixture().model_dump(mode='json')
        source['name'] = '# title\n## forged <script>|*'
        source['description_markdown'] = '# source\n```python\nraise RuntimeError()\n```\n`````\nfinal'
        text = to_markdown(source)
        self.assertNotIn('\n## forged', text)
        self.assertIn('&lt;script&gt;', text.splitlines()[0])
        self.assertIn('  ## forged <script>|*\n  ```', text)
        self.assertIn('  ``````text\n', text)
        self.assertIn('  # source\n', text)
        self.assertIn('  `````\n  final\n  ``````', text)

    def test_empty_null_false_and_zero_are_distinct(self):
        doc = Document('Values', 'test')
        doc.section('values', {'unknown': None, 'zero': 0, 'false': False, 'empty': '',
                               'map': {}, 'list': [], 'string': 'null'})
        text = doc.finish()
        for value in ('`null`', '：0', '`false`', '：""', '对象，0 项', '列表，0 项', '："null"'):
            self.assertIn(value, text)

    def test_revalidation_limits_and_determinism(self):
        data = fixture().model_dump(mode='json')
        self.assertEqual(to_markdown(data), to_markdown(dict(reversed(list(data.items())))))
        with self.assertRaises(ValueError): to_markdown('{"record_kind":"x","record_kind":"y"}')
        with self.assertRaises(ValueError): to_markdown({'record_kind': 'other'})
        with self.assertRaises(ValueError): to_markdown(fixture().model_copy(update={'revision': 0}))
        with patch('element.language._markdown.MAX_BYTES', 50):
            with self.assertRaisesRegex(ValueError, 'Markdown output'): to_markdown(fixture())

    def test_cli_json_stdin_and_toml_file(self):
        env = {**os.environ, 'PYTHONIOENCODING': 'utf-8'}
        result = subprocess.run([sys.executable, '-B', '-m', 'element', 'language'],
                                input=fixture().model_dump_json(), capture_output=True,
                                text=True, encoding='utf-8', env=env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(result.stdout, to_markdown(fixture()))
        path = 'examples/element/indicator.toml'
        result = subprocess.run([sys.executable, '-B', '-m', 'element', 'language', path],
                                capture_output=True, text=True, encoding='utf-8', env=env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(result.stdout, to_markdown(load_component(path)))


if __name__ == '__main__': unittest.main()
