import json
from engine.schema.result import TraceFrame


def frame(state, collisions=()):
    return TraceFrame(time_s=state.time_s, body_poses=dict(state.body_poses),
                      joint_positions=dict(state.joint_positions), joint_velocities=dict(state.joint_velocities),
                      network_samples=dict(state.network_samples), behavior_outputs=dict(state.behavior_outputs),
                      sensor_samples=dict(state.sensor_samples), effects=dict(state.effects), collisions=collisions)


def write_ndjson(frames, stream):
    for item in frames:
        stream.write(item.model_dump_json() + "\n")
