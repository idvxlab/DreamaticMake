import tempfile
import unittest
from pydantic import ValidationError
from element.schema.commerce import Procurement
from element.schema.library import ElementDefinition, ElementQuery
from element.library import ElementLibrary
from element.io.components import load_component
from engine.interface.bridge import designs, handle

class InterfaceTests(unittest.TestCase):
    def test_every_example_projects_and_gripper_moves(self):
        for id in designs():
            with self.subTest(id=id):
                result = handle({'method': 'view', 'id': id})
                self.assertIn('scene', result)
        a = handle({'method': 'view', 'id': 'gripper'})
        key, joint = next((k,j) for k,j in a['draft']['joints'].items() if j['kind']=='prismatic')
        b = handle({'method': 'view', 'id': 'gripper', 'joint_inputs': {key: joint['upper']}})
        self.assertNotEqual(a['scene']['bodies'], b['scene']['bodies'])
        self.assertEqual(b['motion']['status'], 'completed')

    def test_common_procurement_and_search_rebuild(self):
        for invalid in [{'price': -1.0}, {'price': float('inf')}, {'purchase_url':'javascript:alert(1)'}, {'currency':'bad'}]:
            with self.assertRaises(ValidationError): Procurement(**invalid)
        with tempfile.TemporaryDirectory() as root:
            library = ElementLibrary(root)
            model = load_component('examples/element/gripper.json')
            self.assertNotIn('procurement', model.model_dump(mode='json'))
            model = model.replace(procurement=Procurement(manufacturer='Test Maker', model='GR-01', tags=('robotics',), price=12.5))
            d = ElementDefinition(library_id='test',element_id=model.id,name=model.name,category=model.category,model=model)
            library.publish(d)
            for query in ['夹爪','GR-0','robot','demo.gripper','Test Maker']:
                self.assertEqual(len(library.search(ElementQuery(text=query))['items']),1)
            library.rebuild_index()
            self.assertEqual(len(library.search(ElementQuery(text='GR-0'))['items']),1)
            self.assertEqual(library.search(ElementQuery(categories=('sensor',)))['items'],[])
