"""Host-owned preparation, bounded dependency DAG and one evidence envelope."""
import base64
import hashlib
import json
from pathlib import Path
import uuid
from element.base.reference import AssetRef
from element.io.records import record_hash
from .contracts import (ToolRequest, PreparedJob, ToolRunResult, PoseOptions, TrajectoryOptions,
    CollisionOptions, TrajectoryCollisionOptions, OCCTOptions, SismicOptions)
from . import source
from .assets import read_verified
from .cache import dependency_key, publish
from .registry import TOOLS, versions


OPTIONS = {('native_kinematics','pose'):PoseOptions, ('native_kinematics','sample_trajectory'):TrajectoryOptions,
    ('fcl_collision','collision'):CollisionOptions, ('fcl_collision','clearance'):CollisionOptions,
    ('fcl_collision','trajectory_collision'):TrajectoryCollisionOptions, ('occt_geometry','inspect_step'):OCCTOptions,
    ('occt_geometry','tessellate'):OCCTOptions, ('sismic_statechart','validate'):SismicOptions, ('sismic_statechart','simulate'):SismicOptions}


def prepare(request, context):
    if not isinstance(request, ToolRequest): request = ToolRequest.model_validate_json(json.dumps(request))
    def stopped(status, reason): return PreparedJob(request=request, status=status, requirements=(reason,))
    try:
        if request.snapshot_id != context.snapshot_id or request.source_kind != source.kind(context.source):
            return stopped('invalid', 'Request source kind or snapshot differs from frozen source')
        cls = OPTIONS.get((request.tool_id, request.operation))
        if cls is None: return stopped('unsupported', 'Operation is not registered')
        options = cls.model_validate_json(json.dumps(request.options))
        distribution, pinned, _, _ = TOOLS[request.tool_id]
        if distribution and versions(request.tool_id).get(distribution) != pinned:
            return stopped('unsupported', 'Pinned tool dependency is missing or incompatible')
        if source.kind(context.source) != 'design_v3' and request.tool_id in ('occt_geometry','sismic_statechart'):
            return stopped('unsupported', 'Operation requires native v3 source; no implicit migration')
        data, mapping, dependencies, omissions, plan = {}, {}, {}, [], []
        if request.tool_id == 'sismic_statechart':
            from .sismic.adapter import prepare as prepare_sismic
            data, mapping, dependencies = prepare_sismic(request, context)
        elif request.tool_id == 'occt_geometry':
            from .occt.adapter import entries
            candidates = list(entries(context.source))
            known = {e[k] for e in candidates for k in ('ref','body','owner')}
            if set(request.scope)-known: return stopped('invalid','Unknown STEP scope')
            selected = [e for e in candidates if not request.scope or any(e['ref']==s or e['body']==s or
                e['owner']==s or e['owner'].startswith(s+'/') for s in request.scope)]
            if not selected: return stopped('needs_input','No declared STEP geometry in scope')
            data = {'entries':selected, 'assets':{}, 'options':options.model_dump(mode='json')}
        else:
            from .kinematics.adapter import frames
            trajectory = request.operation in ('sample_trajectory','trajectory_collision')
            data['frames'] = frames(context.source, options, trajectory)
            if request.tool_id == 'native_kinematics':
                refs = set(data['frames'][0]['poses'])
                selected = {r for r in refs if not request.scope or any(r==s or r.startswith(s+'/') for s in request.scope)}
                if any(not any(p==r or p.startswith(r+'/') for p in refs) for r in request.scope): return stopped('invalid','Unknown kinematics scope')
                for frame in data['frames']: frame['poses'] = {k:v for k,v in frame['poses'].items() if k in selected}
                mapping = {r:{'ref':r} for r in selected}
                for ref in selected:
                    parts = ref.split('/')
                    mapping[ref]['display_ref'] = ref.replace('/links/', '/bodies/') if source.kind(context.source) == 'design_v3' else ref
                data['acceptance'] = bool(selected) and source.kind(context.source) == 'design_v3' and not any(
                    j.type in ('prismatic','revolute') and (j.limit is None or j.limit.lower is None or j.limit.upper is None)
                    for j in context.source.effective_joints().values())
                if not data['acceptance']: omissions.append('Joint position limits or acceptance coverage are incomplete')
            else:
                from .fcl.adapter import select
                selected, pairs, omissions = select(context.source, request.scope, options)
                if len(selected) > 256 or len(pairs) * len(data['frames']) > 100_000: return stopped('unsupported','Collision pair/sample budget exceeded')
                if source.kind(context.source) == 'design_v3' and context.source.motion.collision_policy:
                    return stopped('unsupported', 'Declared collision policy requires a supported typed profile')
                data.update(entries=selected, pairs=pairs, omissions=omissions, assets={}, minimum_m=options.minimum_m)
        for e in data.get('entries', []):
            mapping[e['ref']] = {k:e[k] for k in ('ref','owner','body')}
            parts = e['body'].split('/')
            mapping[e['ref']]['display_ref'] = e['body'].replace('/links/', '/bodies/') if source.kind(context.source) == 'design_v3' else e['body']
            mapping[e['ref']]['pointer'] = e.get('pointer', source.pointer('mechanical',*e['ref'].split('/')[1:]))
            mapping[e['ref']]['document'] = e.get('document',context.source.unit_occurrences()[e['owner']].location.path if source.kind(context.source) == 'design_v3' else 'resolved-layout-v2')
            g = e['geometry']
            if g['type'] in ('mesh','brep'):
                ref = AssetRef.model_validate_json(json.dumps(g['asset_ref']))
                value = read_verified(context.asset_resolver, e['owner'], ref)
                data['assets'][ref.sha256] = base64.b64encode(value).decode('ascii')
                dependencies[e['owner']+':'+ref.sha256] = ref.sha256
                if g['type'] == 'brep' and request.tool_id == 'fcl_collision':
                    if g.get('selection'): return stopped('unsupported','STEP selection profile is unavailable')
                    plan.append({'tool_id':'occt_geometry','operation':'tessellate','ref':e['ref']})
                    if versions('occt_geometry').get('cadquery-ocp') != TOOLS['occt_geometry'][1]: return stopped('unsupported','BRep collision requires pinned OCCT dependency')
        if len(plan) > 32: return stopped('unsupported','Dependency task budget exceeded')
        dependencies.update(source_snapshot=context.snapshot_id, options=options.model_dump(mode='json'),
            scope=list(request.scope), versions=versions(request.tool_id), adapter='1', tool_contract='tools/1')
        dependencies['input_digest'] = dependency_key(data)
        return PreparedJob(request=request, status='ready', tool_input=data, source_map=mapping,
            dependency_manifest=dependencies, plan=tuple(plan), omissions=tuple(omissions))
    except NotImplementedError as error: return stopped('unsupported',str(error))
    except (ValueError, KeyError, OSError) as error: return stopped('needs_input',str(error))


def run(prepared, context):
    from engine.execution import ExecutionResult
    from .runner import execute
    from .presentation import present
    if not isinstance(prepared, PreparedJob): raise ValueError('run requires a PreparedJob')
    request = prepared.request
    # Rebuild trusted inputs from current frozen source and re-read hashes before execution.
    current = prepare(request, context)
    if current != prepared: raise ValueError('Prepared inputs changed; prepare again')
    run_id = str(uuid.uuid4())
    folder = context.workspace / 'runs' / run_id
    folder.mkdir(parents=True, exist_ok=False)
    publish(folder/'request.json', request.model_dump(mode='json'))
    publish(folder/'manifest.json', prepared.dependency_manifest)
    publish(folder/'source-map.json', prepared.source_map)
    data = json.loads(json.dumps(prepared.tool_input))
    raw, execution, outcome = {}, ('unsupported' if prepared.status == 'unsupported' else 'failed'), 'unknown'
    findings, artifacts = [], []
    actual_versions = versions(request.tool_id)
    import time
    deadline = time.monotonic() + context.timeout_s
    def call(tool, operation, value):
        remaining = deadline-time.monotonic()
        if remaining <= 0: raise TimeoutError('Tool dependency deadline exceeded')
        return execute(tool, operation, value, timeout_s=min(24,remaining), cancelled=context.cancelled, directory=folder)
    try:
        if context.cancelled(): raise InterruptedError('Tool request cancelled')
        if prepared.ready:
            geometry_cache = {}
            occt_versions = call('occt_geometry','probe',{})['versions'] if prepared.plan else {}
            for job in prepared.plan:
                entry = next(e for e in data['entries'] if e['ref'] == job['ref'])
                key = dependency_key({'geometry':entry['geometry'],'options':OCCTOptions().model_dump(mode='json'),
                    'versions':occt_versions,'adapter':'1','contract':'tools/1'})
                cached = context.workspace/'cache'/key/'geometry.json'
                derived = geometry_cache.get(key)
                if derived is None and cached.exists() and cached.stat().st_size <= 16_000_000:
                    envelope = json.loads(cached.read_text(encoding='utf-8'))
                    if envelope.get('key') == key and envelope.get('digest') == dependency_key(envelope['value']):
                        derived = envelope['value']
                if derived is None:
                    derived = call('occt_geometry','tessellate',{'entries':[entry], 'assets':data['assets'], 'options':OCCTOptions().model_dump(mode='json')})
                    if derived['versions'] != occt_versions: raise ValueError('OCCT probe/execution versions differ')
                    if not derived['findings']:
                        publish(cached,{'key':key,'digest':dependency_key(derived),'value':derived})
                geometry_cache[key] = derived
                if derived['findings']: raise ValueError('Invalid BRep cannot be used as collision geometry')
                mesh = {**derived['meshes'][0], 'ref':entry['ref']}
                digest = hashlib.sha256(base64.b64decode(mesh['data_base64'])).hexdigest()
                data['assets'][digest] = mesh['data_base64']
                entry['geometry'] = {'type':'mesh','unit':mesh['unit'],'asset_ref':{'artifact_id':digest,'sha256':digest,'media_type':'model/stl'}}
                data['omissions'].append('Tessellation has no proven outer error bound: '+entry['ref'])
                actual_versions.update(derived['versions'])
            raw = call(request.tool_id, request.operation, data)
            execution, outcome = raw['execution'], raw['outcome']
            actual_versions.update(raw.get('versions', {}))
            for package, version in versions(request.tool_id).items():
                if raw.get('versions',{}).get(package) != version: raise ValueError('Probe/execution versions differ')
            findings = raw.get('findings', [])
            publish(folder/'raw/report.json',raw)
        else:
            findings = [{'code':'prepare.'+prepared.status, 'message':r, 'severity':'warning', 'refs':[]} for r in prepared.requirements]
    except InterruptedError as error:
        execution, outcome = 'cancelled','unknown'
        findings = [{'code':'worker.cancelled','message':str(error),'severity':'warning','refs':[]}]
    except Exception as error:
        execution, outcome = 'failed','unknown'
        findings = [{'code':'worker.failed','message':str(error),'severity':'error','refs':[]}]
    for i, finding in enumerate(findings):
        finding['finding_id'] = f'{run_id}:{i}'
        if any(ref not in prepared.source_map for ref in finding.get('refs', [])): raise ValueError('Worker returned unknown source ref')
    for field in ('frames','trace','outputs','measurements','reports'):
        if raw.get(field):
            relative = f'artifacts/{field}.json'
            publish(folder/relative, raw[field])
            artifacts.append({'id':f'{run_id}/{field}', 'kind':'trajectory' if field in ('frames','trace') else field,
                'path':relative,'sha256':hashlib.sha256((folder/relative).read_bytes()).hexdigest()})
    for i, mesh in enumerate(raw.get('meshes', [])):
        relative = f'artifacts/mesh-{i}.stl'
        (folder/'artifacts').mkdir(exist_ok=True)
        value = base64.b64decode(mesh['data_base64'],validate=True)
        (folder/relative).write_bytes(value)
        artifacts.append({'id':f'{run_id}/mesh-{i}','kind':'mesh','path':relative,'sha256':hashlib.sha256(value).hexdigest(), 'ref':mesh['ref'], 'unit':mesh['unit']})
    evidence = ExecutionResult(run_id=run_id, subject_snapshot_id=context.snapshot_id,
        options_hash=record_hash(prepared.dependency_manifest.get('options',request.options),'execution-options-v1'),
        scenario_hash=record_hash(data['scenario'],'scenario-v2') if 'scenario' in data else None,
        input_asset_hashes={**(context.source.asset_hashes if source.kind(context.source) == 'design_v3' else {}),
            **{k:v for k,v in prepared.dependency_manifest.items() if ':' in k}},
        backend_versions=actual_versions, execution=execution,outcome=outcome,
        coverage=tuple(raw.get('coverage', [])),diagnostics=tuple(findings),trace_refs=tuple(a['id'] for a in artifacts))
    result = ToolRunResult(tool_id=request.tool_id,operation=request.operation,evidence=evidence.model_dump(mode='json'),
        coverage_items=tuple({'ref':ref, 'covered':execution=='completed', 'method':raw.get('method',request.operation),
            'unit':'s' if request.tool_id == 'sismic_statechart' else 'm',
            'omissions':list(data.get('omissions',prepared.omissions))} for ref in prepared.source_map),
        findings=tuple(findings),artifacts=tuple(artifacts),source_map=prepared.source_map)
    result = result.model_copy(update={'presentation':present(result,context.snapshot_id)})
    publish(folder/'result.json',result.model_dump(mode='json'))
    return result
