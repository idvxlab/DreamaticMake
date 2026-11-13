"""Lightweight execution evidence. Completion and assertion outcome are distinct."""
import importlib.metadata
import uuid
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Sha256
from element.io.records import record_hash
from engine.design.professional import key, resolved_poses
from element.schema.professional import OccurrenceRef


class ExecutionResult(Contract):
    schema_version: Literal['execution_contract/1.0.0-draft'] = 'execution_contract/1.0.0-draft'
    run_id: str
    subject_snapshot_id: Sha256
    scenario_hash: Sha256 | None = None
    input_asset_hashes: dict[str, Sha256] = Field(default_factory=dict)
    backend_versions: dict[str, str] = Field(default_factory=dict)
    model_versions: dict[str, str] = Field(default_factory=dict)
    options_hash: Sha256
    execution: Literal['completed', 'failed', 'unsupported', 'cancelled']
    outcome: Literal['pass', 'fail', 'unknown']
    coverage: tuple[str, ...] = ()
    diagnostics: tuple[dict, ...] = ()
    trace_refs: tuple[str, ...] = ()


def capabilities():
    result = {'kinematics': 'native/1', 'electrical_rules': 'native/1', 'urdf_export': 'native/1'}
    for backend, distribution in (('mesh_geometry', 'trimesh'), ('fcl_collision', 'python-fcl'),
                                  ('occt_geometry', 'cadquery-ocp'), ('sismic_statechart', 'sismic')):
        try: result[backend] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError: result[backend] = None
    # Installed dependency does not by itself mean a backend is implemented.
    return result


def run_check(p, backend, *, options=None, asset_resolver=None):
    if backend in ('kinematics','native_kinematics','occt_geometry','fcl_collision'):
        from pathlib import Path
        from engine.tools import ToolContext, ToolRequest, prepare, run
        from engine.tools.source import kind
        tool = 'native_kinematics' if backend == 'kinematics' else backend
        operation = {'native_kinematics':'pose','occt_geometry':'inspect_step','fcl_collision':'collision'}[tool]
        context = ToolContext(p, Path(__file__).resolve().parents[1]/'workspace/tools', asset_resolver)
        request = ToolRequest(request_id=str(uuid.uuid4()),tool_id=tool,operation=operation,
            snapshot_id=context.snapshot_id,source_kind=kind(p),options=options or {})
        return ExecutionResult.model_validate_json(__import__('json').dumps(run(prepare(request,context),context).evidence))
    options = options or {}
    diagnostics, coverage, execution, outcome = [], [], 'completed', 'unknown'
    try:
        if backend == 'mesh_geometry':
            from element.io.mesh import resolve_stl, MeshDependencyError
            from element.interfaces.geometry import TriangleMesh
            count = 0
            for instance in p.unit_occurrences():
                for link in p.definition(instance).mechanical.links.values():
                    for graphic in (*link.visuals.values(), *link.collisions.values()):
                        if graphic.geometry.type != 'mesh': continue
                        count += 1
                        g = graphic.geometry
                        shape = TriangleMesh(asset_ref=g.asset_ref, unit=g.unit,
                            collision_mode=getattr(graphic, 'interpretation', 'surface'))
                        resolver = (lambda ref: asset_resolver(instance, ref)) if asset_resolver else None
                        try: resolve_stl(shape, resolver)
                        except MeshDependencyError:
                            execution = 'unsupported'
                            diagnostics.append({'code': 'mesh.dependency_unavailable'})
                            break
            coverage = ['STL bytes/hash', 'explicit unit scale', 'triangle budget', 'solid topology/winding/positive volume'] if count else []
            if execution == 'completed' and count: outcome = 'pass'
        elif backend == 'electrical_rules':
            pins = p.occurrences('electrical', 'pins')
            used = set()
            for id, net in p.effective_nets().items():
                values = [pins[key(r)] for r in net.nodes]
                used.update(key(r) for r in net.nodes)
                outputs = [r for r, pin in zip(net.nodes, values) if pin.electrical_type == 'output' and pin.default_config.get('drive') == 'push_pull']
                if len(outputs) > 1:
                    diagnostics.append({'code': 'electrical.driver_conflict', 'net': id, 'severity': 'error'})
                roles = {(v.power or {}).get('role') for v in values}
                if 'source' in roles and net.kind == 'ground':
                    diagnostics.append({'code': 'electrical.power_ground_short', 'net': id, 'severity': 'error'})
            declared = {key(p.composition.project_ref(OccurrenceRef.model_validate_json(__import__('json').dumps(u['pin'])))) for u in p.circuit_logic.unconnected}
            for pin in sorted(pins.keys() - used - declared):
                diagnostics.append({'code': 'electrical.uncovered_pin', 'pin': pin, 'severity': 'warning'})
            for ref, config in p.circuit_logic.pin_config.items():
                pin = pins.get(ref)
                modes = pin.capabilities.get('modes') if pin else None
                if not pin or not modes or config.get('mode') not in modes:
                    diagnostics.append({'code': 'electrical.pin_config_unverified', 'pin': ref, 'severity': 'warning'})
            if p.circuit_logic.buses or p.circuit_logic.interface_config:
                diagnostics.append({'code': 'electrical.bus_configuration_not_executed', 'severity': 'warning'})
            coverage = ['pin/net references', 'duplicate membership', 'push-pull conflict', 'power/ground conflict', 'unconnected coverage']
            outcome = 'fail' if any(d.get('severity') == 'error' for d in diagnostics) else ('unknown' if diagnostics else 'pass')
        else:
            execution = 'unsupported'
            diagnostics.append({'code': 'backend.unsupported', 'backend': backend,
                'message': 'No executable adapter for this profile; dependency availability is not execution evidence'})
    except ValueError as error:
        execution, outcome = 'failed', 'fail'
        diagnostics.append({'code': 'input.invalid', 'message': str(error)})
    return ExecutionResult(run_id=str(uuid.uuid4()), subject_snapshot_id=p.snapshot_id,
        input_asset_hashes=p.asset_hashes, options_hash=record_hash(options, 'execution-options-v1'),
        backend_versions={backend: 'native/1'}, execution=execution, outcome=outcome,
        coverage=tuple(coverage), diagnostics=tuple(diagnostics))


def run_project_scenario(p, root, relative):
    """Compatibility projection of the same tool-service evidence and trace."""
    import json
    from pathlib import Path
    from element.io.package import package_file
    from element.io.load import read_record
    from engine.tools import ToolContext, ToolRequest, prepare, run
    from engine.tools.assets import file_resolver
    context = ToolContext(p, Path(__file__).resolve().parents[1]/'workspace/tools',
        file_resolver({'project':root}), lambda ref: read_record(package_file(root,ref)))
    request = ToolRequest(request_id=str(uuid.uuid4()),tool_id='sismic_statechart',operation='simulate',
        snapshot_id=p.snapshot_id,source_kind='design_v3',scenario_ref=relative)
    result = run(prepare(request,context),context)
    trace = next((a for a in result.artifacts if a['path']=='artifacts/trace.json'),None)
    frames = json.loads((context.workspace/'runs'/result.evidence['run_id']/trace['path']).read_text(encoding='utf-8')) if trace else []
    return {**result.evidence,'trace':frames}
