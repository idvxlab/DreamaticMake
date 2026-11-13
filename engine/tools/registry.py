"""Trusted static allowlist; describing tools does not load native libraries."""
import importlib.metadata

TOOLS = {
    'occt_geometry': ('cadquery-ocp', '7.8.1.1.post1', ('inspect_step', 'tessellate'), 'engine.tools.occt.backend'),
    'fcl_collision': ('python-fcl', '0.7.0.11', ('collision', 'clearance', 'trajectory_collision'), 'engine.tools.fcl.backend'),
    'native_kinematics': (None, None, ('pose', 'sample_trajectory'), 'engine.tools.kinematics.adapter'),
    'sismic_statechart': ('sismic', '1.6.11', ('validate', 'simulate'), 'engine.tools.sismic.backend'),
}


def versions(tool):
    distribution = TOOLS[tool][0]
    if not distribution: return {'native_kinematics': 'native/1'}
    try: return {distribution: importlib.metadata.version(distribution)}
    except importlib.metadata.PackageNotFoundError: return {}


def describe(probe=False):
    from .service import OPTIONS
    import time
    deadline = time.monotonic()+22
    result = []
    for id, (distribution, pinned, operations, _) in TOOLS.items():
        installed = versions(id)
        compatible = distribution is None or installed.get(distribution) == pinned
        ready, reason = None, 'Not probed'
        if probe and compatible:
            from .runner import execute
            try:
                budget = min(8, deadline-time.monotonic())
                if budget <= 0: raise TimeoutError('Tool probe deadline exceeded')
                raw = execute(id, 'probe', {}, timeout_s=budget)
                ready, reason = True, ''
                installed = raw['versions']
            except Exception as error: ready, reason = False, str(error)
        result.append({'id': id, 'adapter_version': '1', 'operations': list(operations),
            'options_schema': {operation:OPTIONS[id,operation].model_json_schema() for operation in operations},
            'source_kinds': ['design_v3', 'layout_v2'] if id in ('native_kinematics', 'fcl_collision') else ['design_v3'],
            'availability': {'implemented': True, 'dependency_installed': bool(installed),
                'version_compatible': compatible, 'worker_ready': ready, 'versions': installed,
                'reason': reason if compatible else 'Missing or incompatible pinned dependency'},
            'limitations': ['Discrete samples only; no dynamics', 'Missing geometry is not a pass'] if id == 'fcl_collision' else
                ['Single unit, restricted-v1, explicit wakeups; no hardware bridge'] if id == 'sismic_statechart' else
                ['Whole STEP only; no automatic repair or manufacturing acceptance'] if id == 'occt_geometry' else ['Forward kinematics only; no dynamics']})
    return result
