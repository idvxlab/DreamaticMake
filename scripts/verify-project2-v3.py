"""Current native-project integrity and real-tool checks; outputs live under workspace/."""
import argparse
import json
from pathlib import Path
import sys

REPO=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(REPO))
from engine.project_io import load_design_package
from engine.design.professional import resolved_poses, key, bill_of_materials, project_views
from engine.tools import ToolRequest, prepare, run
from engine.tools.source import project_context
from engine.tools.cache import publish
from engine.execution import run_check


def verify(root, tools=True):
    root=root.resolve(strict=True)
    package=load_design_package(root)
    assert len(package.index.instances)==18 and len(package.effective_joints())==36
    assert len(package.unit_occurrences())==43
    assert len(package.circuit_logic.nets)==19 and len(package.effective_mount_connections())==54
    assert sum(g['quantity'] for g in bill_of_materials(package))==38
    assert package.index.instances['buzzer_r1'].element_ref==package.index.instances['buzzer_r2'].element_ref
    assert all(i.location.kind=='custom' for i in package.index.instances.values())
    presses=[k for k,j in package.effective_joints().items() if j.type=='prismatic']
    assert len(presses)==5
    samples=[{}]+[{j:q} for j in presses for q in (0.,.0002,.0004)]+[{j:q for j in presses} for q in (.0002,.0004)]
    initial=resolved_poses(package)
    for positions in samples:
        current=resolved_poses(package,positions)
        assert set(current)==set(initial)
        assert current['case_front/links/body']==initial['case_front/links/body']
    assert len(initial)==len(package.occurrences('mechanical','links'))
    pins=package.occurrences('electrical','pins')
    connected={key(r) for n in package.effective_nets().values() for r in n.nodes}
    from element.schema.professional import OccurrenceRef
    unconnected={key(package.composition.project_ref(OccurrenceRef.model_validate_json(json.dumps(v['pin'])))) for v in package.circuit_logic.unconnected}
    assert len(pins)==73 and len(connected)==49 and len(unconnected)==24
    assert connected.isdisjoint(unconnected) and connected|unconnected==pins.keys()
    for c in package.effective_mount_connections().values():
        for end in ('a','b'):
            ref=c[end];owner='/'.join([ref['instance'],*ref.get('unit_path',[])])
            assert ref['id'] in package.definition(owner).mechanical.mounts
    views=project_views(package)
    assert all(views[v]['snapshot_id']==package.snapshot_id for v in ('scene','motion','schematic','logic'))
    from engine.interface.bridge import handle
    software=handle({'method':'software','project_path':str(root)})['projects']
    assert len(software)==1 and software[0]['element_key']=='controller' and software[0]['error'] is None
    assert package.logic.units=={}  # Existing MicroPython is not silently translated to a statechart.
    evidence={'schema_version':'project2-validation/1','snapshot_id':package.snapshot_id,
        'top_level_instances':18,'unit_occurrences':43,'bom_quantity':38,'unique_definitions':len(package.elements),'joints':36,'nets':19,'pins':73,'unconnected_pins':24,
        'mount_connections':54,'pose_samples':len(samples),'native_fk':'completed','software_binding':'pass','external_pool_required':False,
        'tools':[]}
    ctx=project_context(root)
    def tool(tool,operation,options=None,scope=()):
        request=ToolRequest(request_id='project2-verification',tool_id=tool,operation=operation,
            snapshot_id=package.snapshot_id,source_kind='design_v3',options=options or {},scope=scope)
        job=prepare(request,ctx)
        result=run(job,ctx)
        item={'tool':tool,'operation':operation,'scope':list(scope),'options':options or {},'prepare_status':job.status,
            'execution':result.evidence['execution'],'outcome':result.evidence['outcome'],'run_id':result.evidence['run_id'],
            'backend_versions':dict(result.evidence['backend_versions']),'input_digest':job.dependency_manifest.get('input_digest'),
            'findings':list(result.findings),'omissions':list(job.omissions),'artifacts':list(result.artifacts)}
        evidence['tools'].append(item)
        assert item['execution']=='completed',item
        return result
    if tools:
        config=json.loads((root/'analysis/tools.json').read_text(encoding='utf-8'))
        assert config['subject_snapshot_id']==package.snapshot_id,'Saved analysis profiles are stale'
        for profile in config['profiles']:
            result=tool(profile['tool_id'],profile['operation'],profile['options'],tuple(profile.get('scope',())))
            if profile['id']=='pose': assert result.evidence['outcome']=='pass'
    electrical=run_check(package,'electrical_rules')
    evidence['electrical_rules']=electrical.model_dump(mode='json')
    evidence['limitations']=['Declared envelope overlaps are not manufacturer-CAD interference proof',
        'Resistor/cables/connector collision geometry incomplete','No Sismic model, hardware bridge or MCU execution',
        'Historical CAD/print/assembly checks remain tied to their original snapshots']
    filename='project2-v3-verification.json' if tools else 'project2-v3-contract-verification.json'
    publish(ctx.workspace/filename,evidence)
    print(json.dumps({'report':str(ctx.workspace/filename),
        **{k:v for k,v in evidence.items() if k not in ('tools','electrical_rules')}},ensure_ascii=True))
    return evidence


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('project',type=Path,nargs='?',default=REPO/'examples/project_2')
    parser.add_argument('--no-tools',action='store_true');args=parser.parse_args();verify(args.project,not args.no_tools)
