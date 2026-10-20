from math import pi
from engine.base.frame import Pose, scale


def forward_kinematics(ir, positions, root_poses):
    poses = dict(root_poses)
    for key in ir.joint_order:
        bound = ir.joints[key]
        joint = bound.spec
        if joint.kind == "fixed":
            motion = Pose()
        elif joint.kind == "prismatic":
            motion = Pose(translation_m=scale(joint.axis, positions[key]))
        else:
            motion = Pose.axis_angle(joint.axis, positions[key])
        poses[bound.child] = poses[bound.parent].compose(joint.parent_anchor).compose(motion).compose(joint.child_anchor.inverse())
    return poses


def apply_transmissions(ir, positions):
    for t in ir.transmissions:
        value = positions[t.driver]
        factor = t.spec.ratio if t.spec.kind == "rotary_ratio" else t.spec.lead_m_per_rev / (2 * pi)
        positions[t.follower] = factor * value + t.spec.offset.si_value


def advance_positions(ir, current, commands, dt):
    positions = dict(current)
    violations = []
    for key, (mode, value) in commands.items():
        joint = ir.joints[key].spec
        limit = joint.velocity_limit.si_value if joint.velocity_limit else None
        if mode == "position":
            delta = value - current[key]
            if limit is not None:
                delta = max(-limit * dt, min(limit * dt, delta))
            positions[key] += delta
        else:
            velocity = value
            if limit is not None and abs(velocity) > limit:
                violations.append(key)
                velocity = max(-limit, min(limit, velocity))
            positions[key] += velocity * dt
        bounds = joint.position_limit
        if bounds:
            lo, hi = bounds.min.si_value, bounds.max.si_value
            if positions[key] < lo or positions[key] > hi or (mode == "position" and not lo <= value <= hi):
                violations.append(key)
                positions[key] = max(lo, min(hi, positions[key]))
    apply_transmissions(ir, positions)
    for t in ir.transmissions:
        limits = ir.joints[t.follower].spec.position_limit
        if limits and not limits.min.si_value <= positions[t.follower] <= limits.max.si_value:
            violations.append(t.follower)
    velocities = {k: (v - current[k]) / dt for k, v in positions.items()}
    for t in ir.transmissions:
        limit = ir.joints[t.follower].spec.velocity_limit
        if limit and abs(velocities[t.follower]) > limit.si_value + 1e-9:
            violations.append(t.follower)
    return positions, velocities, tuple(sorted(set(violations)))
