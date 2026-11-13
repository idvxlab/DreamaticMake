"""Project folder resolution, exact pins and compact assembly-layer behavior."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from element.io.records import element_ref
from element.tests.test_library import fixture
from element.tests.test_retrieval import pool_fixture
from engine.io.load import load
from engine.layout import import_layout, dispatch_layout
from engine.project_io import load_project
from engine.language import to_markdown


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding='utf-8')


def project_fixture(root):
    write(root / 'project.json', {'record_kind': 'project_manifest', 'project_version': 2, 'id': 'fixture', 'title': 'Fixture'})
    write(root / 'element/index.json', {'elements': {'a': {'kind': 'custom', 'path': 'part'}, 'b': {'kind': 'custom', 'path': 'part'}}})
    write(root / 'element/part/manifest.json', {'record_kind': 'element_package', 'package_version': '1', 'component_path': 'component.json'})
    write(root / 'element/part/component.json', fixture().model.model_dump(mode='json'))
    write(root / 'design/structure.json', {'placements': {'b': {'translation_m': [.2, 0, 0]}}})
    write(root / 'design/motion.json', {})
    write(root / 'design/circuit-logic.json', {})
    write(root / 'doc/index.json', {'stages': {}})


class ProjectIOTests(unittest.TestCase):
    def test_custom_defaults_reuse_and_read_only_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project_fixture(root)
            write(root / 'element/part/component.json', {'id': 'part', 'name': 'Draft part', 'category': 'structure'})
            before = {p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            source = load_project(root)
            self.assertEqual(source['elements']['a'], source['elements']['b'])
            self.assertEqual(source['elements']['a']['geometry']['bodies'], {})
            self.assertEqual(load(root).project_version, 2)
            self.assertIn('element\\_sources', to_markdown(load(root)))
            self.assertEqual({p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file()}, before)

    def test_library_exact_pin_and_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'project'
            project_fixture(root)
            pool = Path(tmp) / 'pool'
            pool.mkdir()
            definition, _, _ = pool_fixture(pool)
            descriptor = {'folder': '01_resistor', 'ref': element_ref(definition).model_dump(mode='json')}
            write(root / 'element/reference.json', descriptor)
            write(root / 'element/index.json', {'elements': {'a': {'kind': 'library', 'path': 'reference.json'}}})
            write(root / 'design/structure.json', {})
            source = load_project(root, element_pool=pool)
            self.assertEqual(source['elements']['a'], definition.model.model_dump(mode='json'))
            descriptor['ref']['content_hash'] = '0'*64
            write(root / 'element/reference.json', descriptor)
            with self.assertRaisesRegex(ValueError, 'pin'): load_project(root, element_pool=pool)

    def test_path_escape_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'project'
            project_fixture(root)
            write(Path(tmp) / 'outside.json', {})
            for relative in ('../../outside.json', 'C:/outside.json', 'part\\component.json'):
                write(root / 'element/index.json', {'elements': {'a': {'kind': 'library', 'path': relative}}})
                with self.assertRaises(ValueError): load_project(root)

    def test_motion_and_electrical_interfaces(self):
        source = load_project('examples/project_2')
        before = copy.deepcopy(source)
        draft = import_layout(source)
        self.assertEqual(source, before)
        self.assertEqual(len(draft['entities']), 43)
        initial = dispatch_layout('layout_motion', {'draft': draft})
        changed = dispatch_layout('layout_motion', {'draft': draft, 'joint_inputs': {'button_stop/joints/press': .0002}})
        self.assertEqual(changed['motion']['status'], 'completed')
        self.assertNotEqual(initial['scene']['bodies'], changed['scene']['bodies'])
        bad = copy.deepcopy(source)
        bad['circuit_logic']['nets']['piezo_pwm']['members'][1] = 'buzzer_r1/missing'
        with self.assertRaises(ValueError): import_layout(bad)
