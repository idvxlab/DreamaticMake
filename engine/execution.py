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
    options = options or {}
    diagnostics, coverage, execution, outcome = [], [], 'completed', 'unknown'
    try:
        if backend == 'kinematics':
            if p.motion.couplings or p.motion.configurations or any(p.definition(i).mechanical.couplings for i in p.index.instances):
                execution = 'unsupported'
                diagnostics.append({'code': 'kinematics.coupling', 'message': 'Coupling execution is not implemented in this profile'})
            else:
                resolved_poses(p, options.get('positions'))
                coverage = ['link references', 'forest structure', 'root placements', 'initial positions', 'joint limits', 'forward kinematics']
                missing_limits = [id for id, j in p.effective_joints().items() if j.type in ('prismatic','revolute')
                    and (j.limit is None or j.limit.lower is None or j.limit.upper is None)]
                diagnostics.extend({'code':'kinematics.limits_unknown','joint':id} for id in missing_limits)
                outcome = 'unknown' if missing_limits else 'pass'
        elif backend == 'mesh_geometry':
            from element.io.mesh import resolve_stl, MeshDependencyError
            from element.interfaces.geometry import TriangleMesh
            count = 0
            for instance in p.index.instances:
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
            for id, net in p.circuit_logic.nets.items():
                values = [pins[key(r)] for r in net.nodes]
                used.update(key(r) for r in net.nodes)
                outputs = [r for r, pin in zip(net.nodes, values) if pin.electrical_type == 'output' and pin.default_config.get('drive') == 'push_pull']
                if len(outputs) > 1:
                    diagnostics.append({'code': 'electrical.driver_conflict', 'net': id, 'severity': 'error'})
                roles = {(v.power or {}).get('role') for v in values}
                if 'source' in roles and net.kind == 'ground':
                    diagnostics.append({'code': 'electrical.power_ground_short', 'net': id, 'severity': 'error'})
            declared = {key(OccurrenceRef.model_validate_json(__import__('json').dumps(u['pin']))) for u in p.circuit_logic.unconnected}
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
    import hashlib
    import json
    from element.io.package import package_file
    from element.io.load import read_record
    from element.base.reference import AssetRef
    from engine.statechart import Scenario, run_statechart
    if relative not in p.logic.scenarios: raise ValueError('Scenario is not registered in logic record')
    scenario = Scenario.model_validate_json(read_record(package_file(root, relative)))
    if scenario.design_snapshot_id != p.snapshot_id: raise ValueError('Scenario design snapshot differs')
    result = {'execution': 'unsupported', 'outcome': 'unknown', 'trace': [], 'coverage': []}
    if len(p.logic.units) != 1: raise ValueError('Current statechart profile requires exactly one unit')
    if p.logic.bindings or p.logic.hardware_bindings:
        raise ValueError('Current statechart profile does not execute hardware or inter-unit bindings')
    unit = next(iter(p.logic.units.values()))
    model = unit['model_ref']
    if model.get('backend') != 'sismic': raise ValueError('Scenario requires a Sismic model')
    if model.get('version') != '1.6.11' or model.get('semantic_profile') != 'restricted-v1':
        raise ValueError('Unsupported Sismic version or semantics profile')
    if any(s.target not in unit.get('ports', {}) or unit['ports'][s.target]['direction'] not in ('in','bidirectional') for s in scenario.stimuli):
        raise ValueError('Stimulus requires a declared input event port')
    asset = AssetRef.model_validate_json(json.dumps(model['asset_ref']))
    data = package_file(root, asset.relative_path).read_bytes()
    if hashlib.sha256(data).hexdigest() != asset.sha256: raise ValueError('YAML model hash differs')
    diagnostics = []
    try:
        result = run_statechart(data.decode('utf-8'), scenario)
    except ImportError:
        diagnostics.append({'code': 'sismic.unavailable'})
    except Exception as error:
        # Sismic also raises contract/nondeterminism/evaluation errors. All are
        # execution failures with diagnostics, never a successful evidence record.
        result.update(execution='failed', outcome='unknown')
        diagnostics.append({'code': 'sismic.execution_failed', 'message': str(error)})
    evidence = ExecutionResult(run_id=str(uuid.uuid4()), subject_snapshot_id=p.snapshot_id,
        scenario_hash=record_hash(scenario, 'scenario-v2'), input_asset_hashes={**p.asset_hashes, asset.relative_path: asset.sha256},
        backend_versions={'sismic': capabilities()['sismic_statechart'] or 'unavailable'},
        model_versions={unit.get('id', 'statechart'): asset.sha256},
        options_hash=record_hash({'profile': scenario.backend_profile}, 'execution-options-v1'),
        execution=result['execution'], outcome=result['outcome'], coverage=tuple(result['coverage']),
        diagnostics=tuple([*diagnostics, *({'code': 'assertion.failed', **failure} for failure in result.get('failures', []))]))
    return {**evidence.model_dump(mode='json'), 'trace': result['trace']}
