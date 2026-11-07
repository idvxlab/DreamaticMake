"""Controller bindings, source confinement and read-only software browsing."""
import json
from pathlib import Path
import tempfile
import unittest
from pydantic import ValidationError
from element.categories import Controller
from element.interfaces.software import SoftwareProject
from engine.interface.bridge import handle
from engine.project_io import load_project
from engine.tests.test_project_io import project_fixture, write


class SoftwareTests(unittest.TestCase):
    def fixture(self, root):
        project_fixture(root)
        write(root / 'element/part/component.json', Controller(id='board', name='ESP32', platform='esp32').model_dump(mode='json'))
        write(root / 'element/index.json', {'elements': {
            'a': {'kind': 'custom', 'path': 'part', 'software': {
                'relative_path': 'software/ESP32_1', 'language': 'cpp', 'entrypoint': 'app_main'}},
            'b': {'kind': 'custom', 'path': 'part', 'software': {
                'relative_path': 'software/ESP32_2/main.py', 'language': 'micropython', 'entrypoint': 'main'}}}})
        for folder, filename in (('ESP32_1', 'src/main.cpp'), ('ESP32_2', 'main.py')):
            path = root / 'software' / folder / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('/* 中文代码 */\nvoid app_main() {}', encoding='utf-8')
        return {'project_path': str(root)}

    def test_defaults_and_unsafe_paths(self):
        self.assertIsNone(SoftwareProject().relative_path)
        self.assertNotIn('software', Controller(id='c', name='C', platform='generic').model_dump())
        for path in ('../secret', 'software/../doc/file', 'software', '/software/c',
                'software\\c', 'software/.env', 'software/c//main.py', 'software/c/./main.py', 'software/c:stream'):
            with self.subTest(path=path), self.assertRaises(ValidationError):
                SoftwareProject(relative_path=path)

    def test_instance_links_and_preview_scope_without_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request = self.fixture(root)
            (root / 'software/ESP32_1/.env').write_text('do not read', encoding='utf-8')
            (root / 'software/ESP32_1/image.bin').write_bytes(b'\x00\xff')
            source = load_project(root)
            self.assertNotEqual(source['elements']['a']['software'], source['elements']['b']['software'])
            original = json.loads((root / 'element/part/component.json').read_text())
            self.assertNotIn('software', original)
            result = handle({**request, 'method': 'software'})
            self.assertEqual(len(result['projects']), 2)
            self.assertEqual([f['path'] for f in result['projects'][0]['files']], ['software/ESP32_1/src/main.cpp'])
            self.assertEqual(len(handle({**request, 'method': 'software', 'target': 'b'})['projects']), 1)
            preview = {**request, 'method': 'software_preview', 'element_key': 'a', 'path': 'software/ESP32_1/src/main.cpp'}
            self.assertIn('中文', handle(preview)['text'])
            for changes in ({'target': 'b'}, {'path': 'software/ESP32_2/main.py'},
                    {'path': 'software/ESP32_1/.env'}, {'path': '../project.json'}, {'element_key': 'missing'}):
                with self.subTest(changes=changes), self.assertRaises(ValueError): handle({**preview, **changes})
            self.assertEqual(json.loads((root / 'element/part/component.json').read_text()), original)
            (root / 'software/ESP32_1/src/main.cpp').write_bytes(b'x' * (2*1024*1024 + 1))
            with self.assertRaisesRegex(ValueError, '2 MiB'): handle(preview)
            (root / 'software/ESP32_2/main.py').unlink()
            self.assertIsNotNone(handle({**request, 'method': 'software'})['projects'][1]['error'])

    def test_noncontroller_override_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project_fixture(root)
            write(root / 'element/index.json', {'elements': {'a': {'kind': 'custom', 'path': 'part',
                'software': {'relative_path': 'software/c'}}}})
            with self.assertRaisesRegex(ValueError, 'controller'): load_project(root)

    def test_linked_software_root_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'project'
            request = self.fixture(root)
            # Windows junctions do not require symlink privileges.
            link = root / 'software/ESP32_1/external'
            outside = Path(tmp) / 'outside'
            outside.mkdir()
            (outside / 'secret.py').write_text('private', encoding='utf-8')
            import os
            if os.name == 'nt':
                import subprocess
                result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(outside)], capture_output=True)
                if result.returncode: self.skipTest('Junction creation is unavailable in this environment')
            else:
                try: link.symlink_to(outside, target_is_directory=True)
                except OSError: self.skipTest('Symlink creation is unavailable in this environment')
            try:
                files = handle({**request, 'method': 'software'})['projects'][0]['files']
                self.assertFalse(any('secret' in f['path'] for f in files))
                write(root / 'element/index.json', {'elements': {'a': {'kind': 'custom', 'path': 'part',
                    'software': {'relative_path': 'software/ESP32_1/external'}}}})
                self.assertIn('symlinks', handle({**request, 'method': 'software'})['projects'][0]['error'])
            finally:
                if os.name == 'nt': link.rmdir()
                else: link.unlink()
