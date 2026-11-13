"""Native FK evaluated by the host; worker returns prepared versioned samples."""
def probe(): return {'kinematics_profile': 'native/1'}


def frames(source, options, trajectory=False):
    from engine.tools.source import poses, kind
    if not trajectory:
        return [{'time_s': 0., 'positions': dict(options.positions),
            'poses': {k: v.model_dump(mode='json') for k, v in poses(source, options.positions).items()}}]
    samples = options.samples
    if any(b.time_s <= a.time_s for a, b in zip(samples, samples[1:])): raise ValueError('Sample times must strictly increase')
    keys = set(samples[0].positions)
    if any(set(s.positions) != keys for s in samples): raise ValueError('Trajectory joints must be identical at every waypoint')
    if kind(source) == 'design_v3':
        continuous = {id for id, j in source.effective_joints().items() if j.type == 'continuous'}
    else:
        from engine.layout import import_layout, parse_layout
        continuous = {id for id,j in parse_layout(import_layout(source)).joints.items() if j.kind == 'continuous'}
    if keys & continuous and options.continuous_policy != 'unwrapped': raise ValueError('Continuous joints require explicit unwrapped policy')
    import math
    values = [(samples[0].time_s, dict(samples[0].positions))]
    for a, b in zip(samples, samples[1:]):
        steps = math.ceil((b.time_s-a.time_s)/options.max_step_s)
        if len(values)+steps > 2000: raise ValueError('Trajectory sample budget exceeded')
        for i in range(1, steps+1):
            ratio = i/steps
            values.append((a.time_s+(b.time_s-a.time_s)*ratio,
                {key: a.positions[key]+(b.positions[key]-a.positions[key])*ratio for key in keys}))
    return [{'time_s': t, 'positions': q, 'poses': {k: v.model_dump(mode='json') for k, v in poses(source, {**options.positions, **q}).items()}} for t, q in values]


def execute(operation, data):
    return {'execution': 'completed', 'outcome': 'pass' if operation == 'pose' and data.get('acceptance') else 'unknown', 'frames': data['frames'], 'findings': [],
        'coverage': ['native forward kinematics; velocity/dynamics not checked']}
