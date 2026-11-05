"""Discovery regressions: partial records, rating semantics and exact evidence pins."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from pydantic import ValidationError
from element.categories import Structure
from element.interfaces.geometry import Box
from element.base.quantity import Parameter, Quantity
from element.base.evidence import Evidence, SourceRecord
from element.schema.library import ElementDefinition
from element.schema.retrieval import RetrievalQuery
from element.library import ElementLibrary, LibraryError
from element.library.retrieval import ElementRetriever, native_record
from element.library.pool import load_element_pool


def fixture():
    model = Structure.from_shape(id='resistor', name='220Ω 电阻 fixture', shape=Box(size_m=(0.01, 0.01, 0.01)),
        parameters={'resistance_selected': Parameter(status='known', value=Quantity(value=220.0, unit='ohm'), evidence_refs=('rated',)),
            'mass': Parameter(status='unknown'), 'rated_power': Parameter(status='assumed', value=Quantity(value=0.25, unit='W'), evidence_refs=('assumed',))},
        sources={'datasheet': SourceRecord(title='Synthetic fixture only', url='https://example.invalid/fixture')},
        evidence={'rated': Evidence(kind='manufacturer_rated', source_ref='datasheet', conditions='Synthetic fixture', note='Not real hardware'),
            'assumed': Evidence(kind='assumed', conditions='', note='Assumed')})
    return ElementDefinition(library_id='test', element_id=model.id, name=model.name, category='structure', model=model)


def pool_fixture(root):
    definition = fixture()
    folder = root / '01_resistor'
    folder.mkdir()
    native = definition.model_dump(mode='json')
    (folder/'element.json').write_text(json.dumps(native), encoding='utf-8')
    structured = {'record_kind': 'element_conversion_record', 'conversion_schema_version': '1',
        'original_id': folder.name, 'status': 'validated_reference', 'library_id': 'test',
        'element_id': 'resistor', 'revision': 1, 'name': definition.name, 'category': 'structure',
        'model': native['model'], 'blockers': [], 'product': {}}
    (folder/'structured.json').write_text(json.dumps(structured), encoding='utf-8')
    entry = dict(folder=folder.name, name=definition.name, category='structure', status='validated_reference',
        element_path='01_resistor/element.json', structured_path='01_resistor/structured.json', blockers=[])
    index = {'schema_version': '1', 'elements': [entry]}
    (root/'index.json').write_text(json.dumps(index), encoding='utf-8')
    return definition, structured, index


class RetrievalTests(unittest.TestCase):
    def setUp(self):
        self.retriever = ElementRetriever((native_record(fixture()),))

    def test_native_model_parameters_and_evidence(self):
        result = self.retriever.search({'categories': ['structure'], 'requirements': [
            {'parameter_code': 'resistance', 'minimum': {'value': 0.22, 'unit': 'kohm'},
             'maximum': {'value': 220.0, 'unit': 'ohm'}}]})
        candidate = result.items[0]
        self.assertEqual(candidate.assessments[0].outcome, 'match')
        self.assertEqual(candidate.selection_state, 'eligible')
        self.assertIn('datasheet', candidate.assessments[0].facts[0].sources)
        self.assertEqual(candidate.assessments[0].facts[0].evidence['rated']['conditions'], 'Synthetic fixture')
        self.assertTrue(candidate.native_ref)

    def test_assumed_missing_wrong_dimension_never_pass(self):
        for code, unit in [('rated_power', 'W'), ('mass', 'g'), ('continuous_torque', 'N*m'), ('resistance', 'V')]:
            result = self.retriever.search({'requirements': [{'parameter_code': code, 'minimum': {'value': 0.1, 'unit': unit}}]})
            self.assertEqual(result.items[0].assessments[0].outcome, 'unknown')
            self.assertEqual(result.items[0].selection_state, 'needs_review')

    def test_hard_soft_mismatch_and_stable_pagination(self):
        query = {'requirements': [{'parameter_code': 'resistance', 'minimum': {'value': 300.0, 'unit': 'ohm'}}]}
        self.assertEqual(self.retriever.search(query).items, ())
        self.assertEqual(self.retriever.search({**query, 'include_mismatches': True}).items[0].selection_state, 'rejected')
        query['requirements'][0]['hard'] = False
        self.assertEqual(self.retriever.search(query).items[0].selection_state, 'needs_review')
        generation = self.retriever.generation
        self.assertEqual(self.retriever.search({'expected_generation': generation}).total, 1)
        with self.assertRaises(LibraryError): self.retriever.search({'expected_generation': '0'*64})
        with self.assertRaises(ValidationError): self.retriever.search({'limit': 1000})

    def test_plan_parses_units_and_exposes_unparsed_wishes(self):
        result = self.retriever.search({'text': '找220Ω电阻，便宜、小巧'})
        self.assertEqual(result.plan.categories, ('circuit_element',))
        self.assertEqual(result.plan.requirements[0].parameter_code, 'resistance')
        self.assertTrue(result.plan.warnings)
        result = self.retriever.search({'text': '质量至少9g，供电5V'})
        self.assertEqual([r.parameter_code for r in result.plan.requirements], ['mass', 'supply_voltage'])
        result = self.retriever.search({'text': '3到6V电机'})
        self.assertEqual(result.plan.requirements[0].minimum.value, 3.0)
        self.assertEqual(result.plan.requirements[0].maximum.value, 6.0)
        result = self.retriever.search({'text': '舵机1.8kg·cm'})
        self.assertEqual(result.plan.requirements, ())
        self.assertTrue(any('compound' in w for w in result.plan.warnings))
        result = self.retriever.search({'text': '质量大于9g'})
        self.assertEqual(result.plan.requirements, ())

    def test_exact_pins_and_defensive_detail_copy(self):
        record = native_record(fixture(), detail={'scope': ['fixture']})
        r = ElementRetriever((record,))
        detail = r.get(record.ref)
        detail['source_detail']['scope'].append('tampered')
        self.assertEqual(r.get(record.ref)['source_detail']['scope'], ['fixture'])
        with self.assertRaises(LibraryError): r.get(record.ref.model_copy(update={'content_hash': '0'*64}))

    def test_read_only_pool_and_partial_admission(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            definition, structured, index = pool_fixture(root)
            before = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*.json')}
            pool = load_element_pool(root)
            self.assertEqual(pool.search({}).items[0].native_ref.element_id, definition.element_id)
            self.assertEqual({p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*.json')}, before)
            self.assertFalse((root/'index.sqlite3').exists())
            index['elements'][0].update(element_path=None, status='incomplete', blockers=['Missing native model'])
            structured.update(status='incomplete', blockers=['Missing native model'])
            (root/'index.json').write_text(json.dumps(index), encoding='utf-8')
            (root/'01_resistor/structured.json').write_text(json.dumps(structured), encoding='utf-8')
            pool = load_element_pool(root)
            candidate = pool.search({}).items[0]
            self.assertFalse(candidate.selectable)
            self.assertIsNone(candidate.native_ref)
            self.assertEqual(pool.search({'include_incomplete': False}).items, ())
            self.assertIn('Missing native model', candidate.blockers)

    def test_pool_confinement_and_index_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, _, index = pool_fixture(root)
            for path in ('../secret.json', 'C:/secret.json', 'secret.env', 'folder\\data.json'):
                index['elements'][0]['structured_path'] = path
                (root/'index.json').write_text(json.dumps(index), encoding='utf-8')
                with self.assertRaises(LibraryError): load_element_pool(root)

    def test_existing_library_uses_model_parameters(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = ElementLibrary(tmp)
            library.publish(fixture())
            retriever = ElementRetriever.from_library(library)
            self.assertEqual(retriever.search({'requirements': [{'parameter_code': 'resistance',
                'minimum': {'value': 220.0, 'unit': 'ohm'}}]}).items[0].assessments[0].outcome, 'match')

    def test_cli_pool_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            pool_fixture(Path(tmp))
            result = subprocess.run([sys.executable, '-B', '-m', 'element', 'retrieve', '--root', tmp],
                input='{}', text=True, encoding='utf-8', capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(json.loads(result.stdout)['total'], 1)
        self.assertTrue(RetrievalQuery.model_json_schema()['properties']['requirements'])
