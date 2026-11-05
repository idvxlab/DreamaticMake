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
        self.assertEqual(len(info['targets']), 9)
        for target in (None, *(item['key'] for item in info['targets'])):
            with self.subTest(target=target):
                result = handle({'method': 'view', 'project_path': info['path'], 'target': target})
                self.assertIn('scene', result)
                self.assertEqual(len(result['draft']['entities']), 9 if target is None else 1)
        a = handle({'method': 'view', 'target': 'gripper'})
        project = handle({'method': 'view'})
        self.assertEqual(len(a['scene']['bodies']), 3)
        self.assertEqual(a['draft']['joints'], {key: joint for key, joint in project['draft']['joints'].items()
            if key.startswith('gripper/')})
        key, joint = next((k,j) for k,j in a['draft']['joints'].items() if j['kind']=='prismatic')
        b = handle({'method': 'view', 'target': 'gripper', 'mode': 'motion', 'joint_inputs': {key: joint['upper']}})
        self.assertNotEqual(a['scene']['bodies'], b['scene']['bodies'])
        self.assertEqual(b['motion']['status'], 'completed')
        structure = handle({'method': 'view', 'target': 'gripper', 'joint_inputs': {key: joint['upper']}})
        self.assertEqual(a['scene']['bodies'], structure['scene']['bodies'])
        with self.assertRaisesRegex(ValueError, 'Unknown project element'):
            handle({'method': 'view', 'target': 'outside'})

    def test_circuit_ports_keep_project_connections_in_element_view(self):
        project = handle({'method': 'view', 'mode': 'circuit'})
        controller = handle({'method': 'view', 'target': 'controller', 'mode': 'circuit'})
        self.assertEqual(len(controller['circuit']['ports']), 5)
        self.assertEqual(controller['circuit']['edges'], [])
        for ref, port in controller['circuit']['ports'].items():
            self.assertEqual(port, project['circuit']['ports'][ref])
            self.assertTrue(port['connections'])
            self.assertIn('physical_pin_number', port)
            self.assertTrue(all(peer != ref for net in port['connections'] for peer in net['peers']))
        pwm = controller['circuit']['ports']['controller/terminals/yaw_pwm']
        self.assertEqual(pwm['physical_pin_number'], '3')
        self.assertEqual(pwm['connections'][0]['peers'], ['yaw/terminals/pwm'])

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
