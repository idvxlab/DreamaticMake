"""Single restricted statechart; no firmware or hardware emulation claim."""
import base64
import json
from engine.statechart import Scenario, run_statechart


def probe():
    import sismic
    return {'sismic_profile': 'restricted-v1'}


def execute(operation, data):
    scenario = Scenario.model_validate_json(json.dumps(data['scenario']))
    result = run_statechart(base64.b64decode(data['yaml_base64'], validate=True).decode('utf-8'), scenario, validate_only=operation == 'validate')
    return {**result, 'findings': [{'code':'assertion.failed', 'severity':'error', 'refs':[data['unit_ref']],
        'message':'Statechart assertion failed', **failure} for failure in result.get('failures', [])]}
