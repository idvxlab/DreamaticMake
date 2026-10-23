from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from element.categories import Structure
from element.interfaces.geometry import Box
from element.schema.library import ElementDefinition, ElementQuery, ElementParameter, Evidence, CatalogEntry
from element.base.quantity import Quantity
from element.io.records import parse_element
from element.library import ElementLibrary, LibraryError

def fixture(element_id='housing', revision=1, library_id='demo'):
    model = Structure.from_shape(id=element_id, revision=revision, name='风机壳体', shape=Box(size_m=(0.1, 0.1, 0.1)))
    return ElementDefinition(library_id=library_id, element_id=element_id, revision=revision,
        name='风机壳体', aliases=('fan-housing',), category='structure', model=model,
        parameters={'width': ElementParameter(value=Quantity(value=100.0, unit='mm'), evidence_ids=('measurement',))},
        evidence={'measurement': Evidence(basis='measurement', statement='Test fixture only')})

class LibraryTests(unittest.TestCase):
    def test_engine_consumes_library_records_without_identity_collision(self):
        from engine.compiler.lower import compile_model
        from engine.adapters.elements import assemble_elements, to_bundle
        a, b = fixture(), fixture(library_id='other')
        self.assertEqual(compile_model(a).snapshot_id, compile_model(to_bundle(a)).snapshot_id)
        bundle = assemble_elements(id='assembly', name='Assembly', elements={'left': a, 'right': b})
        self.assertEqual(len(bundle.components), 2)
        self.assertEqual(len(compile_model(bundle).collection('bodies')), 2)

    def test_all_existing_templates_can_be_library_records(self):
        from element.io.components import load_component
        count = 0
        for path in Path('engine/examples/components').glob('*.json'):
            if path.name.endswith('.scenario.json'): continue
            model = load_component(path)
            definition = ElementDefinition(library_id='templates', element_id=model.id, revision=model.revision,
                name=model.name, category=model.category, origin='template', model=model)
            self.assertEqual(parse_element(definition), definition)
            count += 1
        self.assertGreaterEqual(count, 32)

    def test_legacy_catalog_keeps_unknown_measurements(self):
        from element.io.catalog import import_catalog_part
        part = {'id': 'housing', 'name': 'Housing', 'revision': 'Hardware A', 'geometryVerified': False,
                'dimensions': {'width': 100.0, 'depth': 100.0, 'height': None}, 'source': 'https://example.invalid/datasheet'}
        d = import_catalog_part(part, fixture().model)
        self.assertIsNone(d.parameters['height'].value)
        self.assertEqual(d.product.hardware_revision, 'Hardware A')
        self.assertEqual(d.revision, 1)
        self.assertNotIn('measurement', {e.basis for e in d.evidence.values()})

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.library = ElementLibrary(self.tmp.name)

    def test_element_import_is_engine_independent(self):
        code = '''import sys
from element.categories import *
from element.library import ElementLibrary
from element.schema.library import ElementDefinition
assert not any(n == "engine" or n.startswith("engine.") for n in sys.modules)
'''
        subprocess.run([sys.executable, '-B', '-c', code], check=True, capture_output=True)
        for path in Path('element').rglob('*.py'):
            if 'tests' in path.parts: continue
            import ast
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                if isinstance(node, ast.ImportFrom): self.assertFalse((node.module or '').startswith('engine'))
                if isinstance(node, ast.Import): self.assertFalse(any(n.name.startswith('engine') for n in node.names))

    def test_roundtrip_exact_lookup_and_conflicts(self):
        d = fixture()
        ref = self.library.publish(d)
        self.assertEqual(self.library.get(ref), d)
        self.assertEqual(self.library.publish(d), ref)
        changed = d.model_dump(mode='json'); changed['name'] = 'Changed'
        with self.assertRaisesRegex(LibraryError, 'replace'): self.library.publish(changed)
        bad = ref.model_dump(mode='json'); bad['content_hash'] = '0'*64
        with self.assertRaisesRegex(LibraryError, 'match'): self.library.get(bad)

    def test_two_libraries_and_latest_versions(self):
        for d in (fixture(), fixture(revision=2), fixture(library_id='other')): self.library.publish(d)
        self.assertEqual(len(self.library.search(ElementQuery())['items']), 2)
        self.assertEqual(len(self.library.search(ElementQuery(version_policy='all'))['items']), 3)
        self.assertEqual([r.revision for r in self.library.versions('demo', 'housing')], [1, 2])

    def test_chinese_alias_and_unit_filter(self):
        self.library.publish(fixture())
        for text in ('风机', '壳体', 'fan-housing'):
            self.assertEqual(len(self.library.search(ElementQuery(text=text))['items']), 1)
        query = {'numeric': [{'parameter_code': 'width', 'relation': 'within',
                             'min': {'value': .09, 'unit': 'm'}, 'max': {'value': .11, 'unit': 'm'}}]}
        self.assertEqual(len(self.library.search(query)['items']), 1)
        query['numeric'][0]['parameter_code'] = 'unknown'
        self.assertEqual(self.library.search(query)['items'], [])

    def test_assumptions_do_not_pass_verified_filter(self):
        d = fixture().model_dump(mode='json'); d['evidence']['measurement']['basis'] = 'assumption'
        self.library.publish(d)
        query = {'numeric': [{'parameter_code': 'width', 'relation': 'overlaps',
                             'min': {'value': 100, 'unit': 'mm'}, 'max': {'value': 100, 'unit': 'mm'}}]}
        self.assertEqual(self.library.search(query)['items'], [])
        self.assertEqual(len(self.library.search({**query, 'include_assumptions': True})['items']), 1)

    def test_cursor_stability_and_generation(self):
        for name in ('a', 'b', 'c'): self.library.publish(fixture(name))
        first = self.library.search({'limit': 1})
        second = self.library.search({'limit': 1, 'cursor': first['next_cursor']})
        self.assertNotEqual(first['items'], second['items'])
        self.library.rebuild_index()
        with self.assertRaises(LibraryError) as raised: self.library.search({'limit': 1, 'cursor': first['next_cursor']})
        self.assertEqual(raised.exception.code, 'index_changed')

    def test_withdrawn_is_still_resolvable_and_rebuildable(self):
        d = fixture(); ref = self.library.publish(d)
        self.library.update_catalog(CatalogEntry(ref=ref, status='withdrawn'))
        self.assertEqual(self.library.search({})['items'], [])
        self.assertEqual(self.library.get(ref), d)
        self.library.db_path.unlink()
        fresh = ElementLibrary(self.tmp.name)
        self.assertEqual(fresh.rebuild_index()['indexed_count'], 1)
        self.assertEqual(fresh.search({})['items'], [])
        self.assertEqual(len(fresh.search({'include_deprecated': True, 'version_policy': 'all'})['items']), 1)

    def test_tamper_rejected_and_rebuild_rolls_back(self):
        ref = self.library.publish(fixture())
        path = Path(self.tmp.name) / 'definitions/demo/housing/1.json'
        path.write_text('{"broken": true}', encoding='utf-8')
        with self.assertRaises(ValueError): self.library.get(ref)
        before = self.library.search({})['index_generation']
        with self.assertRaises(ValueError): self.library.rebuild_index()
        self.assertEqual(self.library.search({})['index_generation'], before)

    def test_strict_schema_and_local_references(self):
        d = fixture().model_dump(mode='json')
        d['category'] = 'sensor'
        with self.assertRaises(ValueError): parse_element(d)
        d = fixture().model_dump(mode='json')
        d['model']['geometry']['envelopes']['solid']['body_ref'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'Unresolved'): parse_element(d)
        with self.assertRaisesRegex(ValueError, 'Duplicate'): parse_element('{"name":"a","name":"b"}')

if __name__ == '__main__': unittest.main()
