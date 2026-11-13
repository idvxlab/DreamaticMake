"""FCL adapter uses the same collision world as the historical simulator."""
import json
from types import SimpleNamespace
from element.base.frame import Pose
from element.interfaces.geometry import Envelope
from engine.tools.shared.collision import MeshCollisionWorld


def probe():
    import fcl
    import trimesh
    import rtree
    return {'fcl_native': getattr(fcl, '__fcl_version__', 'not-exposed-by-binding')}


def execute(operation, data):
    import base64
    objects, assets = {}, data.get('assets', {})
    for e in data['entries']:
        shape = dict(e['geometry'])
        t = shape.pop('type')
        shape['kind'] = 'triangle_mesh' if t == 'mesh' else t
        if t == 'mesh': shape['collision_mode'] = e['interpretation']
        spec = Envelope.model_validate_json(json.dumps({'body_ref': 'body', 'shape': shape,
            'pose': e['origin'], 'margin_m': e['margin_m']}))
        objects[e['ref']] = SimpleNamespace(spec=spec, scope=(), body_key=e['body'])
    world = MeshCollisionWorld(SimpleNamespace(collection=lambda _: objects), lambda ref: base64.b64decode(assets[ref.sha256], validate=True))
    findings, measurements = [], []
    pairs = {frozenset(p) for p in data['pairs']}
    for frame in data['frames']:
        poses = {k: Pose.model_validate_json(json.dumps(v)) for k, v in frame['poses'].items()}
        hits = world.query(poses, pairs=pairs, minimum_m=data['minimum_m'])
        for a, b in hits:
            findings.append({'code': 'collision.overlap' if operation != 'clearance' else 'clearance.violation',
                'severity': 'error', 'refs': [a,b], 'message': 'Declared collision geometry violates separation', 'time_s': frame['time_s']})
        measurements.extend({'time_s': frame['time_s'], **m} for m in world.measurements)
    return {'execution': 'completed', 'outcome': 'fail' if findings else ('unknown' if data['omissions'] or not pairs else 'pass'),
        'findings': findings, 'measurements': measurements, 'frames': data['frames'],
        'coverage': ['discrete collision and separation; solid containment; no penetration-depth claim'],
        'sample_times': [f['time_s'] for f in data['frames']], 'method': 'discrete'}
