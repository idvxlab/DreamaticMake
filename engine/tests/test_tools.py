"""Real worker, geometry and evidence regressions for the tool boundary."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import importlib.util
from dataclasses import replace
from unittest.mock import patch
from element.base.frame import Pose
from element.base.reference import AssetRef
from engine.tools import ToolContext, ToolRequest, prepare, run, present, describe
from engine.tools.assets import file_resolver, read_verified
from engine.tools.runner import execute
from engine.tools.source import project_context, pointer


def entry(ref, x=0, size=1):
    return {'ref':ref,'body':ref+'/body','owner':ref,'geometry':{'type':'box','size_m':[size]*3},
        'origin':Pose(translation_m=(x,0.,0.)).model_dump(mode='json'),'margin_m':0.,'interpretation':'solid','approximation':'outer'}


def collision_data(entries, frames=None):
    return {'entries':entries,'assets':{},'omissions':[], 'minimum_m':0.,
        'pairs':[[entries[0]['ref'],entries[1]['ref']]],
        'frames':frames or [{'time_s':0.,'poses':{e['body']:Pose().model_dump(mode='json') for e in entries}}]}


class ToolTests(unittest.TestCase):
    def test_worker_output_budget_tolerates_disappearing_temporary_files(self):
        from engine.tools.runner import output_bytes
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            kept, removed = root/'output.json', root/'transient'
            kept.write_bytes(b'1234567'); removed.write_bytes(b'temporary')
            listing = list(root.iterdir()); removed.unlink()
            with patch.object(Path, 'iterdir', return_value=iter(listing)):
                self.assertEqual(output_bytes(root), 7)

    @classmethod
    def setUpClass(cls):
        cls.context = project_context('examples/project_2')

    def request(self, tool='native_kinematics', operation='pose', **values):
        return ToolRequest(request_id='test',tool_id=tool,operation=operation,
            snapshot_id=self.context.snapshot_id,source_kind='design_v3',**values)

    def test_fk_evidence_and_stale_presentation(self):
        job = prepare(self.request(scope=('cap_stop',)),self.context)
        self.assertTrue(job.ready,job.requirements)
        result = run(job,self.context)
        self.assertEqual(result.evidence['execution'],'completed')
        self.assertEqual(result.evidence['outcome'],'pass')
        self.assertTrue(all(ref.startswith('cap_stop/') for ref in result.source_map))
        self.assertTrue(present(result,'0'*64)['stale'])
        self.assertIsNone(present(result,'0'*64)['trajectory_ref'])
        from engine.tools.host import stored_result, artifact
        value = stored_result(self.context,result.evidence['run_id'])
        self.assertEqual(value['evidence']['run_id'],result.evidence['run_id'])
        data = artifact(self.context,result.evidence['run_id'],result.artifacts[0]['id'])
        self.assertEqual(hashlib.sha256(base64.b64decode(data['data_base64'])).hexdigest(),data['sha256'])
        with self.assertRaises(ValueError): stored_result(self.context,'../request.json')

    def test_request_options_scope_and_missing_dependency(self):
        bad = self.request().model_copy(update={'snapshot_id':'0'*64})
        self.assertEqual(prepare(bad,self.context).status,'invalid')
        self.assertEqual(prepare(self.request(options={'shell':'whoami'}),self.context).status,'needs_input')
        self.assertEqual(prepare(self.request(scope=('missing',)),self.context).status,'invalid')
        with patch('engine.tools.service.versions',return_value={}):
            job = prepare(self.request('fcl_collision','collision'),self.context)
            self.assertEqual(job.status,'unsupported')
            result = run(job,self.context)
            self.assertEqual(result.evidence['outcome'],'unknown')

    def test_owner_hash_and_secret_asset_boundary(self):
        with tempfile.TemporaryDirectory(dir=self.context.workspace) as tmp:
            folder = Path(tmp); (folder/'shape.step').write_bytes(b'geometry')
            digest = hashlib.sha256(b'geometry').hexdigest()
            ref = AssetRef(relative_path='shape.step',sha256=digest,media_type='model/step')
            resolver = file_resolver({'a':folder})
            self.assertEqual(read_verified(resolver,'a',ref),b'geometry')
            with self.assertRaises(ValueError): read_verified(resolver,'b',ref)
            (folder/'shape.step').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'hash'): read_verified(resolver,'a',ref)
            secret = ref.model_copy(update={'relative_path':'.env'})
            with self.assertRaisesRegex(ValueError,'Secrets'): read_verified(resolver,'a',secret)
        self.assertEqual(pointer('a/b','~c'),'/a~1b/~0c')

    @unittest.skipUnless(importlib.util.find_spec('fcl'), 'Optional python-fcl unavailable')
    def test_real_fcl_separation_containment_and_clearance(self):
        for x,expected in ((2.,'pass'),(.25,'fail'),(0.,'fail')):
            data = collision_data([entry('a',size=2),entry('b',x,size=.1)])
            result = execute('fcl_collision','collision',data)
            self.assertEqual(result['outcome'],expected,result)
        data = collision_data([entry('a'),entry('b',1.1)])
        data['minimum_m'] = .11
        result = execute('fcl_collision','clearance',data)
        self.assertEqual(result['outcome'],'fail')
        self.assertAlmostEqual(result['measurements'][0]['distance_m'],.1)
        self.assertIsNone(result['measurements'][0]['penetration_depth'])

    @unittest.skipUnless(importlib.util.find_spec('fcl'), 'Optional python-fcl unavailable')
    def test_solid_mesh_containment_and_surface_profile(self):
        import trimesh
        data = trimesh.creation.box(extents=[2,2,2]).export(file_type='stl')
        digest = hashlib.sha256(data).hexdigest()
        a = entry('a'); a['geometry'] = {'type':'mesh','unit':'m','asset_ref':{'artifact_id':digest,'sha256':digest,'media_type':'model/stl'}}
        for mode,expected in (('solid','fail'),('surface','pass')):
            a['interpretation'] = mode
            request = collision_data([a,entry('b',size=.1)])
            request['assets'] = {digest:base64.b64encode(data).decode('ascii')}
            self.assertEqual(execute('fcl_collision','collision',request)['outcome'],expected)

    @unittest.skipUnless(importlib.util.find_spec('fcl'), 'Optional python-fcl unavailable')
    def test_discrete_middle_collision_and_missing_coverage(self):
        entries = [entry('a'),entry('b',size=.1)]
        frames = [{'time_s':t,'poses':{'a/body':Pose().model_dump(mode='json'),
            'b/body':Pose(translation_m=(x,0.,0.)).model_dump(mode='json')}} for t,x in ((0.,-2.),(.5,0.),(1.,2.))]
        result = execute('fcl_collision','trajectory_collision',collision_data(entries,frames))
        self.assertEqual([f['time_s'] for f in result['findings']],[.5])
        self.assertEqual(result['method'],'discrete')
        request = collision_data([entry('a'),entry('b',2.)]); request['omissions']=['missing manufacturer geometry']
        self.assertEqual(execute('fcl_collision','collision',request)['outcome'],'unknown')

    def test_trajectory_native_samples_and_budget(self):
        request = self.request(operation='sample_trajectory',options={'samples':[
            {'time_s':0.,'positions':{'press/stop':0.}}, {'time_s':.1,'positions':{'press/stop':.0004}}], 'max_step_s':.05})
        job = prepare(request,self.context)
        self.assertTrue(job.ready,job.requirements)
        self.assertEqual(len(job.tool_input['frames']),3)
        self.assertAlmostEqual(job.tool_input['frames'][1]['positions']['press/stop'],.0002)
        self.assertEqual(run(job,self.context).evidence['outcome'],'unknown')

    @unittest.skipUnless(importlib.util.find_spec('OCP'), 'Optional OCCT unavailable')
    def test_real_occt_box_units_tessellation_and_conflict(self):
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
        from OCP.IFSelect import IFSelect_RetDone
        with tempfile.TemporaryDirectory(dir=self.context.workspace) as tmp:
            path = Path(tmp)/'box.step'
            writer = STEPControl_Writer(); writer.Transfer(BRepPrimAPI_MakeBox(10,20,30).Shape(),STEPControl_AsIs)
            self.assertEqual(writer.Write(str(path)),IFSelect_RetDone)
            value = path.read_bytes(); digest = hashlib.sha256(value).hexdigest()
        e = entry('box'); e['geometry'] = {'type':'brep','format':'step','unit':'mm','asset_ref':{'artifact_id':digest,'sha256':digest,'media_type':'model/step'}}
        data = {'entries':[e],'assets':{digest:base64.b64encode(value).decode('ascii')},'options':{'linear_deflection_m':.0001,'angular_deflection_rad':.2}}
        result = execute('occt_geometry','tessellate',data)
        self.assertTrue(result['reports'][0]['valid'])
        self.assertEqual(result['reports'][0]['solids'],1)
        self.assertAlmostEqual(result['reports'][0]['volume_m3'],.000006)
        self.assertAlmostEqual(result['reports'][0]['bounds_m'][3],.01,places=6)
        import trimesh
        import io
        mesh = trimesh.load(io.BytesIO(base64.b64decode(result['meshes'][0]['data_base64'])),file_type='stl')
        self.assertAlmostEqual(mesh.extents[2]*.001,.03)
        e['geometry']['unit']='m'
        with self.assertRaisesRegex(ValueError,'units conflict'): execute('occt_geometry','inspect_step',data)

    @unittest.skipUnless(importlib.util.find_spec('OCP') and importlib.util.find_spec('fcl'), 'Optional geometry tools unavailable')
    def test_brep_dependency_plan_cache_and_native_occurrences(self):
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
        from element.schema.professional import ElementDefinitionV2
        from element.io.records import element_ref, record_hash
        from engine.design.professional import parse_package
        with tempfile.TemporaryDirectory(dir=self.context.workspace) as tmp:
            path = Path(tmp)/'box.step'
            writer = STEPControl_Writer(); writer.Transfer(BRepPrimAPI_MakeBox(10,20,30).Shape(),STEPControl_AsIs); writer.Write(str(path))
            value = path.read_bytes(); digest = hashlib.sha256(value).hexdigest()
            source = self.context.source.model_dump(mode='json')
            instance = source['index']['instances']['case_front']
            definition = source['elements'][instance['element_ref']['content_hash']]
            collision = definition['mechanical']['links']['body']['collisions']['solid']
            collision['geometry'] = {'type':'brep','format':'step','unit':'mm','asset_ref':{'relative_path':'box.step','sha256':digest,'media_type':'model/step'}}
            definition['mechanical']['links']['body']['collisions']['copy'] = json.loads(json.dumps(collision))
            definition = ElementDefinitionV2.model_validate_json(json.dumps(definition))
            ref = element_ref(definition)
            source['elements'][ref.content_hash] = definition.model_dump(mode='json')
            instance['element_ref'] = ref.model_dump(mode='json')
            source['manifest']['element_index_hash'] = record_hash(source['index'],'project-index-v3')
            context = ToolContext(parse_package(source),Path(tmp)/'tools',lambda owner,ref:value)
            request = ToolRequest(request_id='step',tool_id='fcl_collision',operation='collision',snapshot_id=context.snapshot_id,source_kind='design_v3',scope=('case_front',))
            job = prepare(request,context)
            self.assertTrue(job.ready,job.requirements)
            self.assertEqual(len(job.plan),2)
            result = run(job,context)
            self.assertEqual(result.evidence['execution'],'completed',result.findings)
            self.assertEqual(result.evidence['outcome'],'unknown')
            self.assertEqual(len(list(context.workspace.glob('cache/*/geometry.json'))),1)
            self.assertEqual(len(result.source_map),2)
            self.assertTrue(any('Tessellation' in s for c in result.coverage_items for s in c['omissions']))
            again = run(job,context)
            self.assertNotEqual(result.evidence['run_id'],again.evidence['run_id'])
            self.assertEqual(again.evidence['execution'],'completed',again.findings)

    def test_sismic_repeated_events_output_hook_and_validation(self):
        from engine.statechart import Scenario, run_statechart
        text = '''statechart:
  name: test
  root state:
    name: root
    initial: idle
    states:
      - name: idle
        transitions:
          - event: tick
            action: send('observed', value=1)
'''
        scenario = Scenario.model_validate_json(json.dumps({'id':'test','design_snapshot_id':'0'*64,'duration_s':1.,
            'stimuli':[{'id':'a','at_s':.5,'target':'tick'},{'id':'b','at_s':.5,'target':'tick'}]}))
        result = run_statechart(text,scenario)
        self.assertEqual([e['sequence'] for e in result['outputs']],[0,1])
        self.assertEqual([f['event_id'] for f in result['trace'] if f['event_id']],['a','b'])
        self.assertEqual(run_statechart(text,scenario,validate_only=True)['outputs'],[])
        with self.assertRaisesRegex(ValueError,'aliases'): run_statechart('a: &a [1]\nb: *a',scenario)
        from engine.tests.fixtures.statechart import statechart_context
        ctx = statechart_context(self.context)
        req = ToolRequest(request_id='chart',tool_id='sismic_statechart',operation='simulate',snapshot_id=ctx.snapshot_id,source_kind='design_v3',scenario_ref='simulation/interlock.json')
        job = prepare(req,ctx)
        self.assertTrue(job.ready,job.requirements)
        self.assertEqual(run(job,ctx).evidence['outcome'],'pass')

    def test_timeout_cancel_and_worker_allowlist(self):
        with self.assertRaises(TimeoutError): execute('native_kinematics','probe',{},timeout_s=.001)
        with self.assertRaises(InterruptedError): execute('native_kinematics','probe',{},cancelled=lambda:True)
        import time
        start = time.monotonic()
        with self.assertRaises(InterruptedError): execute('native_kinematics','probe',{},cancelled=lambda:time.monotonic()-start>.03)
        with self.assertRaisesRegex(ValueError,'Unregistered'): execute('os','system',{})
        result = run(prepare(self.request(),self.context),replace(self.context,cancelled=lambda:True))
        self.assertEqual((result.evidence['execution'],result.evidence['outcome']),('cancelled','unknown'))



if __name__ == '__main__': unittest.main()
