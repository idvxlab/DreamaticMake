"""Native project integrity and real statechart execution, independent of retired examples."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from element.io.records import record_hash
from element.base.frame import Pose
from element.base.frame import Pose
from engine.design.professional import Structure, Motion, parse_package, project_views, resolved_poses
from engine.project_io import load_design_package
from engine.tools import ToolRequest, prepare, run
from engine.tools.source import project_context
from engine.tests.fixtures.statechart import statechart_context


def repin(data, field):
    cls = {'structure': Structure, 'motion': Motion}[field]
    record = cls.model_validate_json(json.dumps(data[field]))
    data['manifest']['record_pins'][field]['content_hash'] = record_hash(record, 'design-record-v3')


class ProfessionalTests(unittest.TestCase):
    def test_native_pin_reuse_and_shared_projection_snapshot(self):
        p = load_design_package('examples/project_2')
        self.assertEqual((len(p.index.instances), len(p.elements), len(p.circuit_logic.nets)), (38, 20, 19))
        self.assertEqual(p.index.instances['buzzer_r1'].element_ref, p.index.instances['buzzer_r2'].element_ref)
        views = project_views(p)
        self.assertTrue(all(views[v]['snapshot_id'] == p.snapshot_id for v in ('scene', 'motion', 'schematic', 'logic')))

    def test_tamper_missing_roots_duplicate_authority_and_limits(self):
        original = load_design_package('examples/project_2').model_dump(mode='json')
        bad = copy.deepcopy(original)
        bad['motion']['initial_positions']['press/stop'] = .0002
        with self.assertRaisesRegex(ValueError, 'pin'): parse_package(bad)
        repin(bad, 'motion')
        self.assertNotEqual(parse_package(bad).snapshot_id, parse_package(original).snapshot_id)
        bad['motion']['initial_positions']['press/stop'] = .01
        repin(bad, 'motion')
        with self.assertRaisesRegex(ValueError, 'limit'): resolved_poses(parse_package(bad))
        bad = copy.deepcopy(original); bad['structure']['root_placements'] = {}; repin(bad, 'structure')
        with self.assertRaisesRegex(ValueError, 'root'): resolved_poses(parse_package(bad))
        bad = copy.deepcopy(original); bad['structure']['root_placements']['cap_stop/links/body'] = {}; repin(bad, 'structure')
        with self.assertRaisesRegex(ValueError, 'authorit'): parse_package(bad)

    def test_nonidentity_child_anchor_formula(self):
        from element.base.frame import Pose
        data = load_design_package('examples/project_2').model_dump(mode='json')
        child = Pose(translation_m=(.01, -.02, .03), rotation_xyzw=(0., 0., .6, .8))
        data['motion']['joints']['mount/case_rear']['child_origin'] = child.model_dump(mode='json')
        repin(data, 'motion'); changed = parse_package(data)
        poses = resolved_poses(changed)
        joint = changed.motion.joints['mount/case_rear']
        expected = poses['case_front/links/body'].compose(joint.origin).compose(child.inverse())
        self.assertEqual(poses['case_rear/links/body'], expected)

    def test_registered_statechart_uses_real_worker(self):
        ctx = statechart_context(project_context('examples/project_2'))
        request = ToolRequest(request_id='statechart', tool_id='sismic_statechart', operation='simulate',
            snapshot_id=ctx.snapshot_id, source_kind='design_v3', scenario_ref='simulation/interlock.json')
        job = prepare(request, ctx)
        self.assertTrue(job.ready, job.requirements)
        result = run(job, ctx)
        self.assertEqual((result.evidence['execution'], result.evidence['outcome']), ('completed', 'pass'))
        self.assertEqual(result.evidence['backend_versions']['sismic'], '1.6.11')

    def test_pin_and_software_tamper_on_disk(self):
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'project'
            shutil.copytree(Path('examples/project_2'), root)
            target = root/'element/case_front/element.json'
            data = json.loads(target.read_text(encoding='utf-8'))
            data['name'] = 'tamper'
            target.write_text(json.dumps(data), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'pin'): load_design_package(root)
            shutil.copyfile(Path('examples/project_2')/'element/case_front/element.json', target)
            (root/'software/Feather_RP2040_1/main.py').write_text('tampered', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'manifest'): load_design_package(root)

    def test_urdf_rebases_multiple_nonidentity_child_frames(self):
        import xml.etree.ElementTree as ET
        from element.io.records import element_ref
        from element.schema.professional import ElementDefinitionV2
        from engine.urdf import export_urdf
        d = load_design_package(Path('examples/project_2')).model_dump(mode='json')
        for id in ('mount/case_rear', 'mount/inner_tray', 'mount/battery_bridge'):
            d['motion']['joints'][id]['child_origin'] = Pose(translation_m=(.01, -.02, .003),
                rotation_xyzw=(0., .6, 0., .8)).model_dump(mode='json')
        for j in d['motion']['joints'].values():
            if j['type'] != 'fixed': j['limit'].update(velocity=1., effort=1.)
        # Test-only declared limits: they are not written to the example.
        definitions = {}
        replacements = {}
        for hash, e in d['elements'].items():
            # This regression isolates frame rebasing. Real project CAD assets
            # require a separate URDF asset adapter and are never replaced on disk.
            for link in e['mechanical']['links'].values():
                link['visuals'] = {}
                link['collisions'] = {}
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
