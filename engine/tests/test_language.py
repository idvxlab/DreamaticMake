"""Native design and active execution-record language output."""
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
from engine.project_io import load_design_package
from engine.language import to_markdown, to_document


class EngineLanguageTests(unittest.TestCase):
    def test_native_package_is_read_only_and_retains_pins(self):
        package = load_design_package('examples/project_2')
        before = package.model_dump_json()
        with patch('engine.compiler.lower.compile_model', side_effect=AssertionError('No compilation')):
            text = to_markdown(package)
        self.assertEqual(text, to_document(package)['markdown'])
        self.assertIn(package.snapshot_id, text)
        for pin in package.manifest.record_pins.values(): self.assertIn(pin.content_hash, text)
        self.assertEqual(package.model_dump_json(), before)

    def test_active_execution_inputs_keep_their_own_protocol(self):
        for name in ('gripper.project.json', 'actuator.bundle.json'):
            text = to_markdown(Path('engine/tests/fixtures/data', name).read_text(encoding='utf-8'))
            self.assertTrue(text.startswith('#'))

    def test_cli_and_request_envelopes(self):
        result = subprocess.run([sys.executable, '-B', '-m', 'engine', 'schema', 'design_package'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(json.loads(result.stdout)['properties']['schema_version']['const'], '3.0.0-draft')
