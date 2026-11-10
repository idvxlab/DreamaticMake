"""Read-only project workbench bridge; receives bounded JSON from the local UI server."""
import json
import sys
from engine.layout import import_layout, dispatch_layout
from engine.interface.project_browser import context, project_info, selection_key, source_files, preview, mesh_asset


def handle(request):
    method = request.get('method')
    if method in ('tools_describe','tools_prepare','tools_run','tools_result','tools_artifact'):
        from engine.tools import describe, prepare, run, ToolRequest
        from engine.tools.source import project_context, kind
        from engine.tools.host import stored_result, artifact
        if method == 'tools_describe': return {'tools':describe(probe=True)}
        ctx = project_context(request.get('project_path') or str(__import__('engine.interface.project_browser',fromlist=['DEFAULT_PROJECT']).DEFAULT_PROJECT))
        if method == 'tools_result': return stored_result(ctx,request.get('run_id'))
        if method == 'tools_artifact': return artifact(ctx,request.get('run_id'),request.get('artifact_id'))
        if 'tool_request' not in request:
            return {'snapshot_id':ctx.snapshot_id,'source_kind':kind(ctx.source)}
        tool_request = ToolRequest.model_validate_json(json.dumps(request['tool_request']))
        prepared = prepare(tool_request,ctx)
        return prepared.model_dump(mode='json') if method == 'tools_prepare' else run(prepared,ctx).model_dump(mode='json')
    if method not in ('open_project', 'view', 'files', 'preview', 'mesh', 'software', 'software_preview', 'professional_views'): raise ValueError('Unknown operation')
    root, source, manifest = context(request.get('project_path'))
    info = project_info(root, source, manifest)
    if method == 'professional_views':
        from engine.project_io import load_design_package
        from engine.design.professional import project_views
        return project_views(load_design_package(root))
    if method == 'open_project': return info
    target = selection_key(source, request.get('target'))
    if method == 'software':
        from engine.interface.software import software_projects
        return software_projects(root, source, target)
    if method == 'software_preview':
        from engine.interface.software import software_preview
        return software_preview(root, source, target, request.get('element_key'), request.get('path'))
    if method == 'mesh': return mesh_asset(root, source, target, request.get('element_key'), request.get('asset_ref'))
    if method == 'files': return {'files': source_files(root, source, manifest, target)[1]}
    if method == 'preview': return preview(root, source, manifest, target, request.get('path'))
    mode = request.get('mode', 'structure')
    if mode not in ('structure', 'motion', 'circuit'): raise ValueError('Unknown view mode')
    # Preserve declared project connectivity even when external nodes are hidden in an element view.
    from engine.layout_project import expand_ref
    connections = {}
    for name, net in source['circuit_logic']['nets'].items():
        members = [expand_ref(member, 'terminals') for member in net['members']]
        for ref in members:
            connections.setdefault(ref, []).append({'net_ref': 'nets/' + name, 'kind': net['kind'],
                'peers': [member for member in members if member != ref]})
    elements = source['elements']
    if target is not None: source = focused_element(source, target)
    draft = import_layout(source)
    inputs = request.get('joint_inputs', {}) if mode == 'motion' else {}
    result = dispatch_layout('layout_motion', {'draft': draft, 'joint_inputs': inputs})
    for ref, port in result['circuit']['ports'].items():
        port['connections'] = connections.get(ref, [])
        parts = ref.split('/')
        if len(parts) == 3 and parts[1] == 'terminals':
            terminal = elements.get(parts[0], {}).get('wiring', {}).get('terminals', {}).get(parts[2], {})
            if number := terminal.get('physical_pin_number'):
                port['physical_pin_number'] = number
    return {'project': info, 'selection': {'key': target, 'level': 'element' if target is not None else 'project'}, **result}


def focused_element(source, key):
    """A focused project view reuses the project's definition and assembly constraints."""
    prefix = key + '/'
    belongs = lambda ref: ref.startswith(prefix)
    joints = {name: joint for name, joint in source['motion']['joints'].items()
        if belongs(joint['parent']) and belongs(joint['child'])}
    from engine.layout_project import expand_ref
    joint_refs = set(joints) | {expand_ref(ref, 'joints') for ref in source['motion']['configuration'] if belongs(ref)}
    return {**source, 'elements': {key: source['elements'][key]},
        'element_sources': {key: source['element_sources'][key]},
        'structure': {'placements': {}},
        'motion': {'joints': joints,
            'configuration': {k: v for k, v in source['motion']['configuration'].items() if belongs(k)},
            'transmissions': {k: v for k, v in source['motion']['transmissions'].items()
                if expand_ref(v['driver'], 'joints') in joint_refs and expand_ref(v['follower'], 'joints') in joint_refs}},
        'circuit_logic': {'nets': {k: v for k, v in source['circuit_logic']['nets'].items()
            if all(belongs(ref) for ref in v['members'])}}}


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(1_000_001)
        if len(data) > 1_000_000: raise ValueError('Request too large')
        print(json.dumps(handle(json.loads(data)), ensure_ascii=False, allow_nan=False))
    except (ValueError, KeyError, OSError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        sys.exit(2)
