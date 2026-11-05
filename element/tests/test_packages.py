import json
from pathlib import Path
import tempfile
import unittest

from element.io.components import load_component
from element.io.package import package_file, template_paths
from element.library.pool import load_element_pool
from element.tests.test_library import fixture


class PackageTests(unittest.TestCase):
    def make_package(self, root, native=False):
        definition = fixture()
        folder = root / 'housing'
        folder.mkdir()
        filename = 'element.json' if native else 'component.json'
        (folder / filename).write_text(json.dumps(definition.model_dump(mode='json') if native else
            definition.model.model_dump(mode='json')), encoding='utf-8')
        manifest = {'record_kind': 'element_package', 'package_version': '1',
            'name': definition.name, 'category': definition.category,
            ('element_path' if native else 'component_path'): filename}
        if not native: manifest['template_name'] = 'housing'
        (folder / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        return folder, definition

    def test_folder_input_discovery_and_rename_preserve_native_pin(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder, definition = self.make_package(root, native=True)
            self.assertEqual(load_component(folder), definition.model)
            pin = load_element_pool(root).records[0].native_ref
            folder.rename(root / 'meaningful_name')
            self.assertEqual(load_element_pool(root).records[0].native_ref, pin)

    def test_split_package_is_discovered_without_index_or_asset_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder, definition = self.make_package(root)
            (folder / 'notes.json').write_text('{"extra":"metadata"}', encoding='utf-8')
            self.assertEqual(template_paths(root)['housing'], folder / 'component.json')
            self.assertEqual(load_component(folder), definition.model)
            self.assertEqual(len(load_element_pool(root).records), 1)
            self.assertFalse((root / 'index.json').exists())
            for path in ('../other.json', 'C:/other.json', 'assets\\escape.json'):
                with self.assertRaises(ValueError): package_file(folder, path)
