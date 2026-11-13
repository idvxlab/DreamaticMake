import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from engine.interface.bridge import handle
from engine.tests.test_project_io import project_fixture, write


def mesh_fixture(root):
    project_fixture(root)
    refs = {}
    for owner, size in (('a', 1), ('b', 2)):
        data = f'solid {owner}\nendsolid {owner}\n'.encode() * size
        ref = {'relative_path': 'assets/part.stl', 'sha256': hashlib.sha256(data).hexdigest(),
            'media_type': 'model/stl'}
        package = root / 'element' / owner
        write(package / 'manifest.json', {'record_kind': 'element_package', 'package_version': '1', 'component_path': 'component.json'})
        write(package / 'component.json', {'id': owner, 'name': owner, 'category': 'structure',
            'geometry': {'root_body': 'body', 'bodies': {'body': {}}, 'envelopes': {
                'solid': {'body_ref': 'body', 'shape': {'kind': 'triangle_mesh', 'asset_ref': ref, 'unit': 'mm'}}}}})
        (package / 'assets').mkdir()
        (package / 'assets/part.stl').write_bytes(data)
        refs[owner] = ref
    write(root / 'element/index.json', {'elements': {key: {'kind': 'custom', 'path': key} for key in refs}})
    return refs


class ProjectBrowserTests(unittest.TestCase):
    def test_meshes_are_scoped_to_owner_and_hash_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            refs = mesh_fixture(root)
            request = {'method': 'mesh', 'project_path': str(root), 'element_key': 'a', 'asset_ref': refs['a']}
            for owner in refs:
                result = handle({**request, 'element_key': owner, 'asset_ref': refs[owner]})
                self.assertEqual(base64.b64decode(result['data_base64']), (root / f'element/{owner}/assets/part.stl').read_bytes())
            self.assertEqual(handle({**request, 'target': 'a'})['sha256'], refs['a']['sha256'])
            for change in ({'target': 'b'}, {'element_key': 'missing'}, {'asset_ref': refs['b']},
                    {'asset_ref': {**refs['a'], 'relative_path': '../b/assets/part.stl'}},
                    {'asset_ref': {**refs['a'], 'relative_path': 'manifest.json'}}):
                with self.subTest(change=change), self.assertRaises(ValueError):
                    handle({**request, **change})
            (root / 'element/a/assets/part.stl').write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'SHA-256|hash|checksum'):
                handle(request)

    def test_mesh_size_limit(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            refs = mesh_fixture(root)
            with patch('engine.interface.project_browser.MAX_STL_BYTES', 1), self.assertRaises(ValueError):
                handle({'method': 'mesh', 'project_path': str(root), 'element_key': 'a', 'asset_ref': refs['a']})

    def test_arbitrary_project_directory_and_scoped_previews(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'my-project'
            project_fixture(root)
            (root/'doc/note.md').write_text('# Notes\n\nProject documentation.', encoding='utf-8')
            image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
            (root/'doc/photo.png').write_bytes(image)
            (root/'doc/control.py').write_text('raise RuntimeError("Never execute")', encoding='utf-8')
            write(root/'doc/array.json', [1, 2, 3])
            project = handle({'method': 'open_project', 'project_path': str(root)})
            self.assertEqual(project['path'], str(root.resolve()))
            self.assertEqual([item['key'] for item in project['targets']], ['a', 'b'])
            files = handle({'method': 'files', 'project_path': str(root)})['files']
            names = {f['path'] for f in files}
            self.assertIn('design/structure.json', names)
            self.assertIn('doc/note.md', names)
            self.assertNotIn('doc/control.py', names)
            self.assertFalse(any(path.startswith('element/') for path in names))
            preview = handle({'method': 'preview', 'project_path': str(root), 'path': 'doc/note.md'})
            self.assertIn('# Notes', preview['text'])
            preview = handle({'method': 'preview', 'project_path': str(root), 'path': 'doc/photo.png'})
            self.assertEqual(base64.b64decode(preview['data_url'].split(',', 1)[1]), image)
            preview = handle({'method': 'preview', 'project_path': str(root), 'path': 'doc/array.json'})
            self.assertEqual(json.loads(preview['text']), [1, 2, 3])
            files = handle({'method': 'files', 'project_path': str(root), 'target': 'a'})['files']
            self.assertEqual({f['path'] for f in files}, {'component.json', 'manifest.json'})
            for target, path in ((None, 'element/part/component.json'), (None, '../outside.md'),
                ('a', '../../doc/note.md'), (None, 'doc/control.py'), (None, 'C:/secret.json')):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    handle({'method': 'preview', 'project_path': str(root), 'target': target, 'path': path})

    def test_library_definition_files_and_size_limit(self):
        files = handle({'method': 'files', 'target': 'gripper'})['files']
        self.assertIn('component.json', {f['path'] for f in files})
        component = handle({'method': 'preview', 'target': 'gripper', 'path': 'component.json'})
        self.assertEqual(json.loads(component['text'])['id'], 'demo.gripper')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project_fixture(root)
            (root/'doc/large.txt').write_text('x' * (2*1024*1024+1), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'size limit'):
                handle({'method': 'preview', 'project_path': str(root), 'path': 'doc/large.txt'})

    def test_symlink_preview_cannot_reach_outside_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'project'
            project_fixture(root)
            outside = Path(tmp) / 'outside.md'
            outside.write_text('Outside project', encoding='utf-8')
            try: (root/'doc/link.md').symlink_to(outside)
            except OSError: self.skipTest('Symlink creation unavailable')
            self.assertNotIn('doc/link.md', {f['path'] for f in handle({'method': 'files', 'project_path': str(root)})['files']})
            with self.assertRaises(ValueError):
                handle({'method': 'preview', 'project_path': str(root), 'path': 'doc/link.md'})
