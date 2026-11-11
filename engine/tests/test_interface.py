from element.io.package import template_path, template_paths, scenario_path
import tempfile
import unittest
from pydantic import ValidationError
from element.schema.commerce import Procurement
from element.schema.library import ElementDefinition, ElementQuery
from element.library import ElementLibrary
from element.io.components import load_component
from engine.interface.bridge import handle

class InterfaceTests(unittest.TestCase):
    def test_project_targets_and_independent_motion_views(self):
        info = handle({'method': 'open_project'})
        self.assertEqual(len(info['targets']), 38)
        initial = handle({'method': 'view'})
        changed = handle({'method': 'view', 'mode': 'motion', 'joint_inputs': {'press/stop': .0002}})
        self.assertNotEqual(initial['scene']['bodies'], changed['scene']['bodies'])
        structure = handle({'method': 'view', 'joint_inputs': {'press/stop': .0002}})
        self.assertEqual(initial['scene']['bodies'], structure['scene']['bodies'])
        single = handle({'method': 'view', 'target': 'cap_stop'})
        self.assertEqual(len(single['draft']['entities']), 1)
        with self.assertRaisesRegex(ValueError, 'Unknown project element'):
            handle({'method': 'view', 'target': 'outside'})

    def test_circuit_ports_keep_project_connections_in_element_view(self):
        project = handle({'method': 'view', 'mode': 'circuit'})
        controller = handle({'method': 'view', 'target': 'controller', 'mode': 'circuit'})
        self.assertEqual(controller['circuit']['edges'], [])
        port = controller['circuit']['ports']['controller/terminals/gp08']
        self.assertEqual(port, project['circuit']['ports']['controller/terminals/gp08'])
        self.assertTrue(port['connections'])
        self.assertIn('physical_pin_number', port)

    def test_common_procurement_and_search_rebuild(self):
        for invalid in [{'price': -1.0}, {'price': float('inf')}, {'purchase_url':'javascript:alert(1)'}, {'currency':'bad'}]:
            with self.assertRaises(ValidationError): Procurement(**invalid)
        with tempfile.TemporaryDirectory() as root:
            library = ElementLibrary(root)
            model = load_component(template_path('gripper'))
            self.assertNotIn('procurement', model.model_dump(mode='json'))
            model = model.replace(procurement=Procurement(manufacturer='Test Maker', model='GR-01', tags=('robotics',), price=12.5))
            d = ElementDefinition(library_id='test',element_id=model.id,name=model.name,category=model.category,model=model)
            library.publish(d)
            for query in ['夹爪','GR-0','robot','demo.gripper','Test Maker']:
                self.assertEqual(len(library.search(ElementQuery(text=query))['items']),1)
            library.rebuild_index()
            self.assertEqual(len(library.search(ElementQuery(text='GR-0'))['items']),1)
            self.assertEqual(library.search(ElementQuery(categories=('sensor',)))['items'],[])
