import json
import unittest
from element.io.components import load_component
from element.io.package import template_paths
from element.io.records import element_ref, parse_element
from element.migration import migrate_component, migrate_definition
from element.tests.test_library import fixture


class ProfessionalElementTests(unittest.TestCase):
    def test_all_categories_have_an_explicit_adapter(self):
        categories = set()
        for path in template_paths().values():
            if path.name.endswith('.scenario.json'): continue
            model = load_component(path)
            with self.subTest(path=str(path)):
                before = model.model_dump_json()
                new, report = migrate_component(model, library_id='adapter-tests')
                self.assertEqual(model.model_dump_json(), before)
                self.assertNotIn('model', new.model_dump(mode='json'))
                self.assertEqual(new.model.category, model.category)
                self.assertGreater(new.revision, model.revision)
                self.assertEqual(element_ref(parse_element(new)), element_ref(new))
                self.assertTrue(report['source_hash'])
                categories.add(model.category)
        self.assertEqual(len(categories), 14)

    def test_outer_metadata_evidence_is_preserved_without_overwrite(self):
        old = fixture()
        new, report = migrate_definition(old)
        self.assertIn('definition__width', new.parameters)
        self.assertIn('definition__measurement', new.evidence)
        self.assertEqual(new.parameters['definition__width']['evidence_ids'], ['definition__measurement'])
        self.assertEqual(report['metadata_map']['evidence']['measurement'], 'definition__measurement')
        self.assertEqual(new.model.category, old.category)
        self.assertEqual(new.model.geometry, old.model.geometry)


if __name__ == '__main__': unittest.main()
