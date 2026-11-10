"""Resolve a registered scenario and a single typed event-unit from native v3."""
import base64
import json
from element.base.reference import AssetRef
from engine.statechart import Scenario
from engine.tools.assets import read_verified


def prepare(request, context):
    source = context.source
    if len(source.logic.units) != 1 or source.logic.bindings or source.logic.hardware_bindings:
        raise NotImplementedError('restricted-v1 requires one unit and no inter-unit/hardware bindings')
    id, unit = next(iter(source.logic.units.items()))
    ref = f'logic/units/{id}'
    if request.scope and set(request.scope) - {id, ref, unit.get('owner_instance')}:
        raise ValueError('Scope does not select this logic unit')
    model = unit['model_ref']
    if (model.get('backend'), model.get('version'), model.get('semantic_profile')) != ('sismic', '1.6.11', 'restricted-v1'):
        raise NotImplementedError('Unsupported statechart model profile')
    if request.operation == 'validate' and not request.scenario_ref:
        text = json.dumps({'id':'validate','design_snapshot_id':context.snapshot_id,'duration_s':0.})
    else:
        if not request.scenario_ref or request.scenario_ref not in source.logic.scenarios or not context.scenario_resolver:
            raise ValueError('A registered scenario_ref and host resolver are required')
        text = context.scenario_resolver(request.scenario_ref)
    if len(text) > 256_000: raise ValueError('Scenario byte budget exceeded')
    scenario = Scenario.model_validate_json(text)
    if scenario.design_snapshot_id != context.snapshot_id: raise ValueError('Scenario snapshot differs')
    ports = unit.get('ports', {})
    for s in scenario.stimuli:
        port = ports.get(s.target, {})
        if port.get('direction') not in ('in', 'bidirectional') or port.get('type') != 'event':
            raise ValueError('Stimulus requires a declared input event port')
        if port.get('unit') or port.get('fields'):
            raise NotImplementedError('Typed event fields/units require a newer event profile')
    params = unit.get('parameters', {})
    if params:
        scenario = Scenario.model_validate_json(json.dumps({**scenario.model_dump(mode='json'), 'initial': {**params, **scenario.initial}}))
    asset = AssetRef.model_validate_json(json.dumps(model['asset_ref']))
    data = read_verified(context.asset_resolver, 'project', asset)
    return {'unit_ref': ref, 'scenario': scenario.model_dump(mode='json'), 'yaml_base64': base64.b64encode(data).decode('ascii')}, {ref: {'ref': ref,
        'document':source.manifest.design.logic, 'pointer':'/units/'+id}}, {f'project:{asset.relative_path}': asset.sha256}
