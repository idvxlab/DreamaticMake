"""Bounded inline entry points; callers supply snapshots, never library filesystem paths."""
from engine.design import parse_package, project_design, check_design, compile_design, resolve_design
from engine.design.migrate import migrate_layout, instantiate_element
from engine.design.bom import derive_bom

def dispatch_design(method, request, asset_resolver=None):
    if method == 'design_import': return migrate_layout(request['draft'])
    if method == 'design_instantiate': return instantiate_element(request['design'])
    package = parse_package(request['design'])
    if method == 'design_project': return project_design(package)
    if method == 'design_check': return check_design(package, request.get('check_kind', 'references'),
        asset_resolver=asset_resolver, joint_inputs=request.get('joint_inputs'))
    if method == 'design_compile': return compile_design(package, request.get('target', 'layout'))
    if method == 'design_bom': return derive_bom(package)
    if method == 'design_validate':
        resolved = resolve_design(package)
        return {'snapshot_id': resolved.snapshot_id, 'diagnostics': [d.model_dump(mode='json') for d in resolved.diagnostics]}
    raise ValueError('Unknown design method')
