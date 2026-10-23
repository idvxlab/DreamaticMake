"""Adapt editable design layers to the existing, independently checkable layout views."""
from engine.design.contracts import *
from engine.design.resolve import resolve_design, instances
from element.io.save import canonical_json
from element.io.records import record_hash
from engine.layout import parse_layout, dispatch_layout

def layout_projection(resolved):
    draft = {k: {} for k in ('entities', 'bodies', 'envelopes', 'ports', 'edges', 'joints', 'transmissions')}
    draft.update(record_kind='layout_draft', layout_version=1, paths=[])
    omitted = []
    poses = {}
    def pose_for(key, pending=None):
        if key in poses: return poses[key]
        pending = set() if pending is None else pending
        body = resolved.objects.get(key)
        if not isinstance(body, Body) or body.pose is None or key in pending: return None
        pending.add(key)
        parent = pose_for(body.parent_body.key(), pending) if body.parent_body else Pose()
        if parent is None: return None
        poses[key] = parent.compose(body.pose)
        return poses[key]
    for record in resolved.records.values():
        d = record.data
        def key(collection, name): return f'{record.record_id}/{collection}/{name}'
        if record.kind == 'selection':
            for name, instance in instances(d).items():
                draft['entities'][key('instances', name)] = {'name': instance.label}
        elif record.kind == 'structure':
            for name, body in d.bodies.items():
                world = pose_for(key('bodies', name))
                if world is None:
                    omitted.append({'ref': key('bodies', name), 'reason': 'unplaced_or_unresolved_body'})
                    continue
                draft['bodies'][key('bodies', name)] = {'entity': body.instance_ref.key(), 'pose': world.model_dump(mode='json')}
            for name, geo in d.geometry.items():
                draft['envelopes'][key('geometry', name)] = {'body': geo.body_ref.key(), 'pose': geo.pose.model_dump(mode='json'),
                    'shape': geo.shape.model_dump(mode='json'), 'purpose': geo.purpose, 'approximation': geo.approximation, 'margin_m': geo.margin_m}
            for name, connection in d.connections.items():
                if connection.kind != 'fixed': continue
                a, b = resolved.get(connection.a, Mount), resolved.get(connection.b, Mount)
                if a and b:
                    draft['joints'][key('connections', name)] = {'kind': 'fixed', 'parent': a.body_ref.key(), 'child': b.body_ref.key(),
                        'parent_anchor': a.pose.model_dump(mode='json'), 'child_anchor': b.pose.model_dump(mode='json')}
        elif record.kind == 'motion':
            for name, j in d.joints.items():
                draft['joints'][key('joints', name)] = {'parent': j.parent_body.key(), 'child': j.child_body.key(), 'kind': j.kind,
                    'axis': j.axis, 'parent_anchor': j.parent_anchor.model_dump(mode='json'), 'child_anchor': j.child_anchor.model_dump(mode='json'),
                    'lower': j.lower.si_value if j.lower else None, 'upper': j.upper.si_value if j.upper else None,
                    'initial': j.initial.si_value if j.initial else None}
            for name, t in d.transmissions.items():
                draft['transmissions'][key('transmissions', name)] = {'driver': t.driver.key(), 'follower': t.follower.key(), 'kind': t.kind,
                    'factor': t.factor.si_value if t.factor else None, 'offset': t.offset.si_value if t.offset else 0.0}
        elif record.kind == 'circuit_energy':
            for name, terminal in d.terminals.items():
                draft['ports'][key('terminals', name)] = {'entity': terminal.instance_ref.key(), 'domain': 'electrical',
                    'name': terminal.spec.label, 'role': terminal.spec.electrical_role,
                    'body': terminal.body_ref.key() if terminal.body_ref else None, 'pose': terminal.pose.model_dump(mode='json') if terminal.pose else None}
            for name, net in d.nets.items():
                if len(net.members) < 2:
                    omitted.append({'ref': key('nets', name), 'reason': 'incomplete_net'}); continue
                draft['edges'][key('nets', name)] = {'domain': 'electrical', 'kind': net.kind, 'members': [r.key() for r in net.members]}
        elif record.kind == 'flow':
            for name, port in d.ports.items():
                draft['ports'][key('ports', name)] = {'entity': port.instance_ref.key(), 'domain': port.domain, 'direction': port.direction,
                    'required': port.required, 'medium': port.medium if isinstance(port, MaterialPort) else None,
                    'data_type': canonical_json(port.type) if isinstance(port, InformationPort) and port.type else None,
                    'body': port.body_ref.key() if port.body_ref else None, 'pose': port.pose.model_dump(mode='json') if port.pose else None}
            for name, edge in d.edges.items():
                draft['edges'][key('edges', name)] = {'domain': edge.domain, 'kind': edge.scope,
                    'directed': True, 'members': [edge.from_.key(), *[r.key() for r in edge.to]]}
            for path in d.required_paths.values():
                draft['paths'].append({'domain': path.domain, 'source': path.from_.key(), 'target': path.to.key()})
    return parse_layout(draft), omitted

def project_design(package, library=None):
    resolved = resolve_design(package, library)
    layout, omitted = layout_projection(resolved)
    views = dispatch_layout('layout_project', {'draft': layout.model_dump(mode='json')})
    # The original layout fingerprint remains explicit; every view is bound to the design snapshot.
    views['layout_snapshot_id'] = views['snapshot_id']
    views['snapshot_id'] = resolved.snapshot_id
    for name in ('scene', 'circuit', 'flow'): views[name]['snapshot_id'] = resolved.snapshot_id
    return {**views, 'records': [r.model_dump(mode='json', by_alias=True) for r in resolved.records.values()],
            'reference_index': resolved.reverse, 'projection_omissions': omitted,
            'design_diagnostics': [d.model_dump(mode='json') for d in resolved.diagnostics]}

def check_design(package, check_kind='references', *, library=None, asset_resolver=None, joint_inputs=None):
    from uuid import uuid4
    from engine import __version__
    resolved = resolve_design(package, library)
    diagnostics = [d.model_dump(mode='json') for d in resolved.diagnostics]
    options = {'joint_inputs': joint_inputs or {}, 'check_kind': check_kind}
    coverage = [{'refs': [], 'level': 'checked', 'limitations': ['Reference/type checks are not physical verification']}]
    result = None
    unsupported = check_kind not in ('references', 'collision', 'motion', 'connectivity')
    if unsupported:
        coverage = [{'refs': [], 'level': 'unsupported', 'limitations': ['No executor registered for this check']}]
    elif check_kind != 'references':
        layout, omitted = layout_projection(resolved)
        result = dispatch_layout('layout_' + check_kind, {'draft': layout.model_dump(mode='json'), 'joint_inputs': joint_inputs or {}}, asset_resolver)
        report = result.get('check', result.get('motion', {}))
        for item in report.get('diagnostics', []):
            refs = []
            for key in item.get('object_refs', []):
                parts = key.split('/')
                if len(parts) == 3 and parts[0] in resolved.records:
                    refs.append({'record_id': parts[0], 'collection': parts[1], 'object_id': parts[2]})
            diagnostics.append({'code': item['code'], 'severity': item['severity'], 'message': item['message'],
                                'refs': refs, 'field_path': None})
        coverage = [{'refs': [], 'level': 'partial' if omitted or report.get('status') != 'completed' or (check_kind == 'collision' and not report.get('checked')) else 'checked',
                     'limitations': report.get('coverage', []) + ['Only the projected layout subgraph is checked']}]
    errors = any(d['severity'] == 'error' for d in diagnostics)
    unknown = unsupported or any(c['level'] != 'checked' for c in coverage) or bool(diagnostics)
    return {'run_id': 'run_' + uuid4().hex, 'snapshot_id': resolved.snapshot_id, 'check_kind': check_kind,
            'tool_version': __version__, 'options_hash': record_hash(options, 'design-check-options-v1'),
            'status': 'unsupported' if unsupported else 'completed',
            'outcome': 'fail' if errors else 'unknown' if unknown else 'pass',
            'coverage': coverage, 'diagnostics': diagnostics, 'artifacts': [], 'result': result}

def compile_design(package, target='layout', *, library=None):
    """Compile only a declared execution target; never silently turn all layers into a simulation."""
    resolved = resolve_design(package, library)
    if target != 'layout': raise ValueError('Unsupported design execution target; legacy simulation uses ModelBundle')
    if any(d.severity == 'error' for d in resolved.diagnostics): raise ValueError('Design has unresolved or incompatible references')
    layout, omitted = layout_projection(resolved)
    if omitted: raise ValueError('Layout target has incomplete objects')
    return {'target': 'layout', 'snapshot_id': resolved.snapshot_id,
            'input_revisions': dict(resolved.package.manifest.input_revisions),
            'draft': layout.model_dump(mode='json'),
            'limitations': ['Layout execution does not execute Markdown, firmware, code units or physical flow models']}
