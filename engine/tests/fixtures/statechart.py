"""Isolated in-memory statechart; never adds behavior claims to a real project."""
import hashlib
import json
from dataclasses import replace
from element.io.records import record_hash
from engine.design.professional import Logic, parse_package

CHART = '''statechart:
  name: interlock
  root state:
    name: controller
    initial: idle
    states:
      - name: idle
        transitions:
          - event: start
            target: moving
      - name: moving
        transitions:
          - event: stop
            target: idle
'''


def statechart_context(context):
    raw = CHART.encode('utf-8')
    digest = hashlib.sha256(raw).hexdigest()
    data = context.source.model_dump(mode='json')
    data['logic']['units'] = {'controller': {'owner_instance': 'controller',
        'model_ref': {'backend': 'sismic', 'version': '1.6.11', 'semantic_profile': 'restricted-v1',
                      'asset_ref': {'artifact_id': digest, 'sha256': digest, 'media_type': 'application/yaml'}},
        'ports': {event: {'direction': 'in', 'type': 'event'} for event in ('start', 'stop')}}}
    data['logic']['scenarios'] = ['simulation/interlock.json']
    data['logic']['revision'] += 1
    logic = Logic.model_validate_json(json.dumps(data['logic']))
    data['manifest']['record_pins']['logic'] = {'record_id': logic.record_id, 'revision': logic.revision,
        'content_hash': record_hash(logic, 'design-record-v3')}
    package = parse_package(data)
    scenario = json.dumps({'id': 'interlock', 'design_snapshot_id': package.snapshot_id, 'duration_s': 1.,
        'stimuli': [{'id': 'start', 'at_s': .1, 'target': 'start'}, {'id': 'stop', 'at_s': .5, 'target': 'stop'}],
        'assertions': [{'kind': 'at', 'at_s': .5, 'state': 'idle'}]})
    return replace(context, source=package, asset_resolver=lambda owner, ref: raw,
                   scenario_resolver=lambda relative: scenario)
