import copy
import json
from pathlib import Path
import tempfile
import unittest
from element.base.frame import Pose
from element.io.records import record_hash
from engine.project_io import load_design_package, load_project
from engine.design.professional import parse_package, project_views, resolved_poses
from engine.execution import run_check
from engine.statechart import Scenario, run_statechart, validate_code


ROOT = Path('examples/project_1')


def repin(data, field):
    from engine.design.professional import Structure, Motion, Electrical, Logic
    cls = {'structure': Structure, 'motion': Motion, 'circuit_logic': Electrical, 'logic': Logic}[field]
    record = cls.model_validate_json(json.dumps(data[field]))
    data['manifest']['record_pins'][field]['content_hash'] = record_hash(record, 'design-record-v3')


CHART = '''statechart:
  name: command_interlock
  root state:
    name: controller
    initial: idle
    states:
      - name: idle
        transitions:
          - event: start
            guard: event.enabled == True
            target: moving
      - name: moving
        transitions:
          - event: stop
            target: idle
          - guard: after(0.5)
            target: idle
'''


class ProfessionalTests(unittest.TestCase):
    def test_example_migration_equivalence_and_definition_reuse(self):
        from engine.layout import import_layout
        p = load_design_package(ROOT)
        self.assertEqual(len(p.index.instances), 9)
        self.assertEqual(len(p.elements), 7)
        self.assertEqual(len(p.circuit_logic.nets), 5)
        self.assertEqual(p.index.instances['yaw'].element_ref, p.index.instances['elbow'].element_ref)
        baseline = json.loads((ROOT/'doc/migration/layout-v2.json').read_text(encoding='utf-8'))
        for value in (0., .2, -.3):
            from engine.layout import motion, parse_layout
            old = import_layout(baseline)
            old_poses, _ = motion(parse_layout(old), {'shoulder/joints/axis': value})
            new = resolved_poses(p, {'shoulder/joints/axis': value})
            for id, pose in new.items():
                delta = old_poses[id.replace('/links/', '/bodies/')].inverse().compose(pose)
                self.assertLess(max(abs(x) for x in delta.translation_m), 1e-9)
                self.assertAlmostEqual(abs(delta.rotation_xyzw[3]), 1.)
        views = project_views(p)
        self.assertEqual(views['projection_version'], 2)
        self.assertTrue(all(views[v]['snapshot_id'] == p.snapshot_id for v in ('scene', 'motion', 'schematic', 'logic')))
        self.assertEqual(run_check(p, 'kinematics').outcome, 'pass')
        self.assertEqual(run_check(p, 'unavailable').execution, 'unsupported')
        self.assertEqual(run_check(p, 'unavailable').outcome, 'unknown')

    def test_tampering_missing_roots_and_multiple_authorities(self):
        original = load_design_package(ROOT).model_dump(mode='json')
        bad = copy.deepcopy(original)
        bad['motion']['initial_positions']['yaw/joints/axis'] = .1
        with self.assertRaisesRegex(ValueError, 'pin'): parse_package(bad)
        repin(bad, 'motion')
        self.assertNotEqual(parse_package(bad).snapshot_id, parse_package(original).snapshot_id)
        bad = copy.deepcopy(original)
        bad['structure']['root_placements'] = {}
        repin(bad, 'structure')
        with self.assertRaisesRegex(ValueError, 'root'): resolved_poses(parse_package(bad))
        bad = copy.deepcopy(original)
        bad['structure']['root_placements']['yaw/links/shaft'] = {}
        repin(bad, 'structure')
        with self.assertRaisesRegex(ValueError, 'authorit'): parse_package(bad)

    def test_pin_and_software_tamper_on_disk(self):
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'project'
            shutil.copytree(ROOT, root)
            target = root/'element/servo/element.json'
            data = json.loads(target.read_text(encoding='utf-8'))
            data['name'] = 'tamper'
            target.write_text(json.dumps(data), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'pin'): load_design_package(root)
            shutil.copyfile(ROOT/'element/servo/element.json', target)
            (root/'software/controller_1/src/main.cpp').write_text('tampered', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'manifest'): load_design_package(root)

    def test_nonidentity_child_anchor_formula(self):
        p = load_design_package(ROOT)
        d = p.model_dump(mode='json')
        id = 'mount/yaw_shoulder'
        child = Pose(translation_m=(.01, -.02, .03), rotation_xyzw=(0., 0., .6, .8))
        d['motion']['joints'][id]['child_origin'] = child.model_dump(mode='json')
        repin(d, 'motion')
        changed = parse_package(d)
        poses = resolved_poses(changed, {'yaw/joints/axis': .4})
        joint = changed.motion.joints[id]
        expected = poses['yaw/links/shaft'].compose(joint.origin).compose(child.inverse())
        self.assertEqual(poses['shoulder/links/case'], expected)

    def test_sismic_events_timeout_restrictions_and_budget(self):
        scenario = Scenario.model_validate_json(json.dumps({'id': 'interlock', 'design_snapshot_id': '0'*64,
            'duration_s': 1., 'wakeups_s': [.5], 'stimuli': [
                {'id': 'one', 'at_s': 0., 'target': 'start', 'payload': {'enabled': True}},
                {'id': 'two', 'at_s': 0., 'target': 'start', 'payload': {'enabled': True}}],
            'assertions': [{'kind': 'at', 'at_s': .5, 'state': 'idle'}]}))
        result = run_statechart(CHART, scenario)
        self.assertEqual(result['outcome'], 'pass')
        self.assertEqual([f['event_id'] for f in result['trace'] if f['event_id']], ['one', 'two'])
        for code in ('__import__("os")', 'event.__class__', 'event.data.clear()', '[x for x in y]', '2 ** 100000'):
            with self.subTest(code=code), self.assertRaises(ValueError): validate_code(code)
        with self.assertRaisesRegex(ValueError, 'budget'):
            run_statechart(CHART, scenario.model_copy(update={'microstep_budget': 1}))

    def test_urdf_rebases_multiple_nonidentity_child_frames(self):
        import xml.etree.ElementTree as ET
        from element.io.records import element_ref
        from element.schema.professional import ElementDefinitionV2
        from engine.urdf import export_urdf
        d = load_design_package(ROOT).model_dump(mode='json')
        for id in ('mount/base_yaw', 'mount/yaw_shoulder', 'mount/upper_elbow'):
            d['motion']['joints'][id]['child_origin'] = Pose(translation_m=(.01, -.02, .003),
                rotation_xyzw=(0., .6, 0., .8)).model_dump(mode='json')
        for j in d['motion']['joints'].values():
            if j['type'] != 'fixed': j['limit'].update(velocity=1., effort=1.)
        # Test-only declared limits: they are not written to the example.
        definitions = {}
        replacements = {}
        for hash, e in d['elements'].items():
            for j in e['mechanical']['joints'].values():
                if j['type'] != 'fixed': j['limit'].update(velocity=1., effort=1.)
            definition = ElementDefinitionV2.model_validate_json(json.dumps(e))
            ref = element_ref(definition).model_dump(mode='json')
            replacements[hash] = ref
            definitions[ref['content_hash']] = definition.model_dump(mode='json')
        d['elements'] = definitions
        for instance in d['index']['instances'].values(): instance['element_ref'] = replacements[instance['element_ref']['content_hash']]
        d['manifest']['element_index_hash'] = record_hash(d['index'], 'project-index-v3')
        repin(d, 'motion')
        p = parse_package(d)
        urdf = export_urdf(p)
        robot = ET.fromstring(urdf['xml'])
        states = {f'{i}/joints/{j}': value for i in p.index.instances for j, value in p.definition(i).mechanical.initial_positions.items()}
        states.update(p.motion.initial_positions)
        poses = {'synthetic_world': Pose()}
        pending = list(robot.findall('joint'))
        while pending:
            progress = False
            for node in list(pending):
                parent = node.find('parent').attrib['link']
                if parent not in poses: continue
                origin = node.find('origin')
                xyz = tuple(map(float, origin.attrib['xyz'].split()))
                roll, pitch, yaw = map(float, origin.attrib['rpy'].split())
                rotation = Pose.axis_angle((0.,0.,1.), yaw).compose(Pose.axis_angle((0.,1.,0.), pitch)).compose(Pose.axis_angle((1.,0.,0.), roll))
                offset = Pose(translation_m=xyz, rotation_xyzw=rotation.rotation_xyzw)
                movement = Pose()
                if node.attrib['type'] != 'fixed':
                    axis = tuple(map(float, node.find('axis').attrib['xyz'].split()))
                    value = states[urdf['source_map'][node.attrib['name']]]
                    movement = Pose(translation_m=tuple(value*v for v in axis)) if node.attrib['type']=='prismatic' else Pose.axis_angle(axis,value)
                poses[node.find('child').attrib['link']] = poses[parent].compose(offset).compose(movement)
                pending.remove(node)
                progress = True
            self.assertTrue(progress)
        frames = {ref: Pose() for ref in p.occurrences('mechanical','links')}
        from engine.design.professional import key
        for j in p.effective_joints().values(): frames[key(j.child)] = j.child_origin
        native = resolved_poses(p)
        for name, ref in urdf['source_map'].items():
            if name.startswith('link_'):
                delta = native[ref].compose(frames[ref]).inverse().compose(poses[name])
                self.assertLess(max(abs(v) for v in delta.translation_m), 1e-8)
                self.assertAlmostEqual(abs(delta.rotation_xyzw[3]), 1.)

    def test_registered_example_statechart(self):
        from engine.execution import run_project_scenario
        result = run_project_scenario(load_design_package(ROOT), ROOT, 'simulation/interlock.json')
        self.assertEqual((result['execution'],result['outcome']), ('completed','pass'))
        self.assertEqual(result['backend_versions']['sismic'], '1.6.11')

    def test_real_mesh_geometry_profile_and_checksum(self):
        import hashlib
        try: import trimesh
        except ImportError: self.skipTest('Optional mesh toolchain unavailable')
        from element.schema.professional import ElementDefinitionV2
        from element.io.records import element_ref
        d = load_design_package(ROOT).model_dump(mode='json')
        instance = d['index']['instances']['base']
        old_hash = instance['element_ref']['content_hash']
        definition = d['elements'].pop(old_hash)
        data = trimesh.creation.box(extents=(20.,30.,40.)).export(file_type='stl')
        collision = next(iter(definition['mechanical']['links']['body']['collisions'].values()))
        collision['geometry'] = {'type':'mesh','unit':'mm','asset_ref':{'relative_path':'assets/box.stl',
            'sha256':hashlib.sha256(data).hexdigest(),'media_type':'model/stl'}}
        collision['interpretation'] = 'solid'
        definition = ElementDefinitionV2.model_validate_json(json.dumps(definition))
        instance['element_ref'] = element_ref(definition).model_dump(mode='json')
        d['elements'][instance['element_ref']['content_hash']] = definition.model_dump(mode='json')
        d['manifest']['element_index_hash'] = record_hash(d['index'],'project-index-v3')
        package = parse_package(d)
        result = run_check(package,'mesh_geometry',asset_resolver=lambda owner,ref:data)
        self.assertEqual(result.outcome,'pass')
        result = run_check(package,'mesh_geometry',asset_resolver=lambda owner,ref:b'tampered')
        self.assertEqual((result.execution,result.outcome),('failed','fail'))


if __name__ == '__main__': unittest.main()
