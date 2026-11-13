"""Portable v3 example checks. Execution evidence is written only to workspace/."""
import argparse
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from engine.project_io import load_design_package
from engine.design.professional import resolved_poses, joint_positions, key, project_views, bill_of_materials
from engine.tools import ToolRequest, prepare, run
from engine.tools.source import project_context
from engine.tools.cache import publish
from engine.execution import run_check


def verify(root, tools=True):
    root = Path(root).resolve(strict=True)
    p = load_design_package(root)
    expected = {'mini-arm-3dof': (15, 13, 18, 7), 'smart-keypad-safe': (26, 22, 26, 25)}[p.manifest.id]
    assert (len(p.index.instances), len(p.elements), len(p.effective_joints()), len(p.circuit_logic.nets)) == expected
    assert all(i.location.kind == 'custom' for i in p.index.instances.values())
    assert all(d.schema_version == '2.0.0-draft' for d in p.elements.values())
    assert sum(g['quantity'] for g in bill_of_materials(p)) == expected[0]
    bom = json.loads((root/'doc/hardware_selection/bom-v0.2.json').read_text(encoding='utf-8'))
    assert sum(item['quantity'] for item in bom['items']) == expected[0]
    bom_instances = []
    for item in bom['items']:
        assert item['quantity'] == len(item['instances'])
        for id in item['instances']:
            assert item['ref'] == p.index.instances[id].element_ref.model_dump(mode='json')
            bom_instances.append(id)
    assert len(set(bom_instances)) == len(bom_instances) and set(bom_instances) == set(p.index.instances)
    pins = set(p.occurrences('electrical', 'pins'))
    connected = {key(r) for n in p.circuit_logic.nets.values() for r in n.nodes}
    unused = {f"{u['pin']['instance']}/pins/{u['pin']['id']}" for u in p.circuit_logic.unconnected}
    assert not connected & unused and connected | unused == pins
    followers = {c['follower'] for c in p.motion.couplings.values()}
    samples = [{}]
    for id, j in p.effective_joints().items():
        if j.type == 'fixed' or id in followers or not j.limit: continue
        lo, hi = j.limit.lower, j.limit.upper
        if lo is None or hi is None: continue
        samples.extend({id: q} for q in (lo, (lo+hi)/2, hi))
        try: resolved_poses(p, {id: hi+.01})
        except ValueError: pass
        else: raise AssertionError('Joint limit not enforced: ' + id)
    links = set(p.occurrences('mechanical', 'links'))
    for sample in samples:
        assert set(resolved_poses(p, sample)) == links
        q = joint_positions(p, sample)
        for c in p.motion.couplings.values():
            assert abs(q[c['follower']] - c['factor']*q[c['driver']]) < 1e-9
    views = project_views(p)
    assert all(views[v]['snapshot_id'] == p.snapshot_id for v in ('scene', 'motion', 'schematic', 'logic'))
    if p.logic.software_projects:
        from engine.interface.bridge import handle
        projects = handle({'method':'software', 'project_path':str(root)})['projects']
        assert len(projects) == 1 and projects[0]['element_key'] == 'controller' and projects[0]['error'] is None
    assert not p.logic.units  # Source code is not an executed behavior model.
    config = json.loads((root/'analysis/tools.json').read_text(encoding='utf-8'))
    assert config['subject_snapshot_id'] == p.snapshot_id
    ctx = project_context(root)
    evidence = {'snapshot_id':p.snapshot_id, 'instances':expected[0], 'definitions':expected[1],
                'joints':expected[2], 'nets':expected[3], 'pose_samples':len(samples),
                'unconnected_pins':len(unused), 'software_projects':len(p.logic.software_projects), 'tools':[]}
    if tools:
        for profile in config['profiles']:
            request = ToolRequest(request_id='example-v3-verification', tool_id=profile['tool_id'], operation=profile['operation'],
                                  snapshot_id=p.snapshot_id, source_kind='design_v3', options=profile['options'], scope=tuple(profile.get('scope', ())))
            job = prepare(request, ctx)
            result = run(job, ctx)
            item = {'id':profile['id'], 'prepare_status':job.status, 'evidence':dict(result.evidence),
                    'findings':list(result.findings), 'omissions':list(job.omissions), 'artifacts':list(result.artifacts)}
            evidence['tools'].append(item)
            assert result.evidence['execution'] == 'completed', item
            assert not any(f.get('severity') == 'error' for f in result.findings) or profile['tool_id'] == 'fcl_collision', item
    evidence['electrical_rules'] = run_check(p, 'electrical_rules').model_dump(mode='json')
    evidence['tool_outcomes'] = {t['id']:t['evidence']['outcome'] for t in evidence['tools']}
    evidence['findings_to_review'] = sum(len(t['findings']) for t in evidence['tools'])
    evidence['limitations'] = ['Historical v0.1 reports refer to original element revisions',
        'Discrete poses and envelope collisions do not prove continuous clearance or hardware fit',
        'No firmware compilation, flashing, slicing, manufacture or physical qualification executed']
    target = ctx.workspace/('v3-verification.json' if tools else 'v3-contract-verification.json')
    publish(target, evidence)
    print(json.dumps({'report':str(target), **{k:v for k,v in evidence.items() if k not in ('tools', 'electrical_rules')}}, ensure_ascii=True))
    return evidence


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', type=Path)
    parser.add_argument('--no-tools', action='store_true')
    args = parser.parse_args()
    verify(args.project, not args.no_tools)
