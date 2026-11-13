"""Hierarchy is source data; FK, BOM, assets and aliases share one resolved graph."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from element.composition import Composition
from element.schema.professional import ElementDefinitionV2, DomainRef
from element.io.records import element_ref, record_hash
from engine.design.professional import (parse_package, ElementIndex, Structure, Motion, Electrical, Logic,
                                       resolved_poses, project_views, bill_of_materials, joint_positions)
from engine.project_io import load_design_package
from engine.query import QueryService, QueryRequest, Selector, Budget
from engine.tools import ToolRequest, prepare
from engine.tools.source import project_context


def ref(id, *path, collection='links', domain='mechanical'):
    return {'unit_path': list(path), 'domain': domain, 'collection': collection, 'id': id}


def package(definition):
    definition = ElementDefinitionV2.model_validate_json(json.dumps(definition))
    pin = element_ref(definition)
    index = ElementIndex.model_validate_json(json.dumps({'instances': {'assembly': {
        'element_ref': pin.model_dump(mode='json'), 'location': {'kind': 'custom', 'path': 'assembly/element.json'}}}}))
    records = {'structure': Structure.model_validate_json(json.dumps({'record_id': 'structure',
                   'root_placements': {'assembly/links/body': {}}})),
               'motion': Motion(record_id='motion'), 'circuit_logic': Electrical(record_id='circuit_logic'),
               'logic': Logic(record_id='logic')}
    return parse_package({'manifest': {'id': 'nested', 'title': 'Nested fixture',
        'element_index_hash': record_hash(index, 'project-index-v3'), 'record_pins': {k: {
            'record_id': v.record_id, 'revision': v.revision, 'content_hash': record_hash(v, 'design-record-v3')}
            for k, v in records.items()}}, 'index': index.model_dump(mode='json'),
        'elements': {pin.content_hash: definition.model_dump(mode='json')},
        **{k:v.model_dump(mode='json') for k,v in records.items()}})


def nested():
    def body(name):
        return {'kind': 'inline', 'definition': {'name': name, 'category': 'structure',
            'mechanical': {'root_link': 'body', 'links': {'body': {}}},
            'exports': {'mechanical': {'links': {'body': ref('body')}}}}}
    mechanism = {'name': 'Slider', 'category': 'structure', 'units': {'base': body('Base'), 'cap': body('Cap')},
        'bom': {'policy': 'children'}, 'mechanical': {'joints': {'press': {'type': 'prismatic',
            'parent': ref('body', 'base'), 'child': ref('body', 'cap'), 'axis': [0,0,1],
            'origin': {'translation_m': [.01, .02, .03]}, 'child_origin': {'translation_m': [.001,0,0]},
            'limit': {'lower': 0., 'upper': .01}}}, 'initial_positions': {'press':0.}},
        'exports': {'mechanical': {'links': {'body': ref('body','base'), 'moving': ref('body','cap')},
                                   'joints': {'press':ref('press',collection='joints')}}}}
    return {'schema_version': '3.0.0-draft', 'library_id':'test', 'element_id':'nested', 'revision':1,
        'name':'Nested assembly', 'category':'structure', 'form':'assembly', 'bom':{'policy':'children'},
        'units': {'mechanism': {'kind':'inline','definition':mechanism}},
        'exports': {'mechanical': {'links': {'body':ref('body','mechanism'), 'moving':ref('moving','mechanism')},
                                   'joints': {'press':ref('press','mechanism',collection='joints')}}}}


class UnitsTests(unittest.TestCase):
    def test_two_levels_aliases_child_anchor_and_bom(self):
        p = package(nested())
        before = resolved_poses(p)
        after = resolved_poses(p, {'assembly/joints/press':.004})
        self.assertEqual(before['assembly/mechanism/base/links/body'], after['assembly/mechanism/base/links/body'])
        cap = after['assembly/mechanism/cap/links/body']
        self.assertEqual(cap.translation_m[:2], (.009000000000000001, .02))
        self.assertAlmostEqual(cap.translation_m[2], .034)
        self.assertEqual(sum(g['quantity'] for g in bill_of_materials(p)), 2)
        self.assertEqual(len(bill_of_materials(p)), 2)  # Inline identities include their source pointers.
        self.assertEqual(joint_positions(p, {'assembly/joints/press':.004})['assembly/mechanism/joints/press'], .004)
        with self.assertRaisesRegex(ValueError,'limit'): resolved_poses(p, {'assembly/joints/press':.02})
        views = project_views(p)
        self.assertTrue(all(v['snapshot_id']==p.snapshot_id for v in (views['scene'],views['motion'],views['schematic'])))
        source = views['source_map']['assembly/mechanism/cap/mechanical/links/body']
        self.assertEqual(source['pointer'], '/units/mechanism/definition/units/cap/definition/mechanical/links/body')

    def test_invalid_paths_private_exports_cycles_and_versions(self):
        for mutation, message in (
            (lambda d:d['exports']['mechanical']['links']['body'].update(unit_path=['missing']), 'Unknown child'),
            (lambda d:d['exports']['mechanical']['links']['body'].update(collection='pins'), 'mismatch'),
            (lambda d:d['units']['mechanism']['definition']['exports']['mechanical']['links'].pop('body'), 'Private'),
            (lambda d:d['exports']['mechanical']['links']['body'].update(unit_path=[]), 'Unresolved'),
            (lambda d:d.update(schema_version='2.0.0-draft'), 'v3'),
        ):
            data = nested(); mutation(data)
            with self.subTest(message=message), self.assertRaisesRegex(ValueError,message): package(data)
        p=package(nested())
        with self.assertRaisesRegex(ValueError,'Duplicate joint aliases'):
            resolved_poses(p, {'assembly/joints/press':.001, 'assembly/mechanism/joints/press':.002})

    def test_v2_hash_and_native_roundtrip(self):
        p=load_design_package('examples/project_3')
        self.assertEqual(parse_package(p.model_dump(mode='json')).snapshot_id, p.snapshot_id)
        self.assertTrue(all('units' not in d.model_dump(mode='json') for d in p.elements.values()))
        self.assertTrue(all('unit_path' not in r.model_dump(mode='json') for j in p.effective_joints().values() for r in (j.parent,j.child)))

    def test_project2_shared_definitions_and_movement(self):
        p=load_design_package('examples/project_2')
        self.assertEqual(len(p.index.instances),18)
        self.assertEqual(len(p.unit_occurrences()),43)
        self.assertEqual(p.index.instances['button_stop'].element_ref,p.index.instances['button_plus'].element_ref)
        self.assertEqual(len(p.effective_mount_connections()),54)
        self.assertEqual(sum(g['quantity'] for g in bill_of_materials(p)),38)
        self.assertEqual(len(p.occurrences('electrical','pins')),73)
        initial=resolved_poses(p)
        for distance in (0.,.0002,.0004):
            poses=resolved_poses(p,{'button_stop/joints/press':distance})
            self.assertEqual(initial['button_stop/switch/links/body'],poses['button_stop/switch/links/body'])
            delta=initial['button_stop/cap/links/body'].inverse().compose(poses['button_stop/cap/links/body'])
            self.assertAlmostEqual(delta.translation_m[2],-distance)
        service=QueryService('examples/project_2','test')
        result=service.query(QueryRequest(request_id='nested',project_handle='test',snapshot_id=p.snapshot_id,
            method='layout.inspect',selector=Selector(instances=('button_stop/cap',)),budget=Budget(max_text_tokens=32000)))
        self.assertIn('button_stop/cap/links/body',result.data[0]['links'])
        ctx=project_context('examples/project_2')
        job=prepare(ToolRequest(request_id='nested',tool_id='native_kinematics',operation='pose',
            source_kind='design_v3',snapshot_id=p.snapshot_id,scope=('button_stop',)),ctx)
        self.assertTrue(job.ready,job.requirements)
        self.assertEqual(len(job.tool_input['frames'][0]['poses']),5)

    def test_referenced_child_and_asset_tamper_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'project';shutil.copytree('examples/project_2',root)
            path=root/'element/keycap_small/element.json'
            data=json.loads(path.read_text(encoding='utf-8'));data['name']='Tampered child'
            path.write_text(json.dumps(data),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'pin'):load_design_package(root)
            shutil.copyfile('examples/project_2/element/keycap_small/element.json',path)
            (root/'element/keycap_small/assets/part.stl').write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError,'Asset hash'):load_design_package(root)

    def test_internal_networks_merge_at_exported_pin_and_reject_kind_conflict(self):
        data=nested()
        m=data['units']['mechanism']['definition']
        for name in ('base','cap'):
            m['units'][name]['definition']['electrical']={'pins':{'pin':{'number':'1','electrical_type':'passive'}}}
            m['units'][name]['definition']['exports']['electrical']={'pins':{'pin':ref('pin',domain='electrical',collection='pins')}}
        m['electrical']={'nets':{'ground':{'kind':'ground','nodes':[
            ref('pin','base',domain='electrical',collection='pins'),ref('pin','cap',domain='electrical',collection='pins')]}}}
        m['exports']['electrical']={'pins':{'common':ref('pin','base',domain='electrical',collection='pins')}}
        data['electrical']={'pins':{'external':{'number':'1','electrical_type':'passive'}},'nets':{
            'ground':{'kind':'ground','nodes':[ref('external',domain='electrical',collection='pins'),
                ref('common','mechanism',domain='electrical',collection='pins')]}}}
        p=package(data)
        self.assertEqual(len(p.effective_nets()),1)
        self.assertEqual(len(next(iter(p.effective_nets().values())).nodes),3)
        from engine.execution import run_check
        self.assertEqual(run_check(p,'electrical_rules').outcome,'pass')
        data['electrical']['nets']['ground']['kind']='signal'
        with self.assertRaisesRegex(ValueError,'Conflicting'):package(data)

    def test_parameter_bindings_preserve_pin_and_reject_readonly_range_and_dimension(self):
        p=load_design_package('examples/project_2')
        leaf=ElementDefinitionV2.model_validate_json(json.dumps({'library_id':'test','element_id':'configurable',
            'revision':1,'name':'Configurable','category':'structure','parameters':{'length':{
                'status':'assumed','value':{'value':2,'unit':'mm'},'configurable':True,
                'range':{'min':{'value':1,'unit':'mm'},'max':{'value':4,'unit':'mm'}}}}}))
        pin=element_ref(leaf)
        root=ElementDefinitionV2.model_validate_json(json.dumps({'schema_version':'3.0.0-draft',
            'library_id':'test','element_id':'root','revision':1,'name':'Root','category':'structure',
            'units':{'child':{'kind':'reference','element_ref':pin.model_dump(mode='json'),
                'location':{'kind':'custom','path':'child/element.json'},
                'parameter_bindings':{'length':{'value':{'value':3,'unit':'mm'}}}}}}))
        root_pin=element_ref(root)
        from engine.design.professional import Instance
        instance=Instance.model_validate_json(json.dumps({'element_ref':root_pin.model_dump(mode='json'),
            'location':{'kind':'custom','path':'root/element.json'}}))
        graph=Composition({'root':instance},{pin.content_hash:leaf,root_pin.content_hash:root})
        node=graph.nodes[('root','child')]
        self.assertEqual(node.definition.parameters['length']['value']['value'],3)
        self.assertEqual(node.element_ref,pin)
        self.assertEqual(leaf.parameters['length']['value']['value'],2)
        for binding in ({'value':5,'unit':'mm'},{'value':3,'unit':'V'}):
            d=root.model_dump(mode='json');d['units']['child']['parameter_bindings']['length']['value']=binding
            changed=ElementDefinitionV2.model_validate_json(json.dumps(d));changed_pin=element_ref(changed)
            inst=Instance(element_ref=changed_pin,location=instance.location)
            with self.assertRaises(ValueError):Composition({'root':inst},{pin.content_hash:leaf,changed_pin.content_hash:changed})

    def test_nested_mesh_is_available_in_parent_selection(self):
        from engine.interface.bridge import handle
        p=load_design_package('examples/project_2')
        leaf=p.definition('button_stop/cap')
        asset=leaf.mechanical.links['body'].collisions['solid'].geometry.asset_ref
        result=handle({'method':'mesh','target':'button_stop','element_key':'button_stop/cap',
            'asset_ref':asset.model_dump(mode='json')})
        self.assertEqual(result['sha256'],asset.sha256)
        with self.assertRaisesRegex(ValueError,'outside'):
            handle({'method':'mesh','target':'button_plus','element_key':'button_stop/cap',
                'asset_ref':asset.model_dump(mode='json')})

    def test_native_composites_publish_search_and_discover_without_lowering(self):
        from element.library import ElementLibrary
        from element.library.pool import load_element_pool
        from element.schema.library import ElementQuery
        definition=ElementDefinitionV2.model_validate_json(json.dumps(nested()))
        with tempfile.TemporaryDirectory() as tmp:
            library=ElementLibrary(Path(tmp)/'library')
            pin=library.publish(definition)
            self.assertEqual(library.get(pin),definition)
            self.assertEqual(len(library.search(ElementQuery(text='Nested'))['items']),1)
            library.rebuild_index()
            folder=Path(tmp)/'pool'/'nested';folder.mkdir(parents=True)
            (folder/'manifest.json').write_text(json.dumps({'record_kind':'element_package','package_version':'1',
                'name':definition.name,'category':definition.category,'element_path':'element.json'}),encoding='utf-8')
            (folder/'element.json').write_text(definition.model_dump_json(),encoding='utf-8')
            records=load_element_pool(folder.parent).records
            self.assertEqual(len(records),1)
            self.assertEqual(records[0].native_ref,pin)


if __name__ == '__main__': unittest.main()
