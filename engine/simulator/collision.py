"""AABB broad phase and sphere/OBB narrow phase, without contact dynamics."""

from dataclasses import dataclass
from itertools import combinations
from math import sqrt
from engine.base.frame import rotate, dot, cross, add, scale


@dataclass(frozen=True)
class Collider:
    key: str
    body: str
    center: tuple
    axes: tuple
    half: tuple | None
    radius: float | None

    def extent(self, axis):
        if self.radius is not None:
            return self.radius
        return sum(h * abs(dot(a, axis)) for h, a in zip(self.half, self.axes))


BASIS = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def colliders(ir, poses, conservative=False):
    result = []
    for key, obj in sorted(ir.collection("envelopes").items()):
        envelope = obj.spec
        body = "/".join((*obj.scope, "bodies", envelope.body_ref))
        pose = poses[body].compose(envelope.pose)
        axes = tuple(rotate(pose.rotation_xyzw, a) for a in BASIS)
        shape = envelope.shape
        radius, half = None, None
        if shape.kind == "sphere":
            radius = shape.radius_m + envelope.margin_m
        elif shape.kind == "box":
            half = tuple(x / 2 + envelope.margin_m for x in shape.size_m)
        elif conservative and shape.kind in ("cylinder", "capsule"):
            z = shape.length_m / 2 if shape.kind == "cylinder" else shape.segment_length_m / 2 + shape.radius_m
            half = tuple(x + envelope.margin_m for x in (shape.radius_m, shape.radius_m, z))
        else:
            raise ValueError(f"Unsupported collision shape: {shape.kind}")
        result.append(Collider(key, body, pose.translation_m, axes, half, radius))
    return result


def intersects(a, b):
    delta = add(b.center, scale(a.center, -1))
    # Broad phase.
    if any(abs(dot(delta, axis)) > a.extent(axis) + b.extent(axis) + 1e-12 for axis in BASIS):
        return False
    if a.radius is not None and b.radius is not None:
        return dot(delta, delta) <= (a.radius + b.radius) ** 2 + 1e-12
    if a.radius is not None or b.radius is not None:
        sphere, box = (a, b) if a.radius is not None else (b, a)
        delta = add(sphere.center, scale(box.center, -1))
        closest = box.center
        for axis, half in zip(box.axes, box.half):
            closest = add(closest, scale(axis, max(-half, min(half, dot(delta, axis)))))
        distance = add(sphere.center, scale(closest, -1))
        return dot(distance, distance) <= sphere.radius ** 2 + 1e-12
    # Separating axis theorem: 3 + 3 face normals and 9 edge cross products.
    for axis in (*a.axes, *b.axes, *(cross(x, y) for x in a.axes for y in b.axes)):
        norm = sqrt(dot(axis, axis))
        if norm < 1e-12:
            continue
        axis = scale(axis, 1 / norm)
        if abs(dot(delta, axis)) > a.extent(axis) + b.extent(axis) + 1e-12:
            return False
    return True


def query_collisions(ir, poses, conservative=False):
    return tuple((a.key, b.key) for a, b in combinations(colliders(ir, poses, conservative), 2)
                 if a.body != b.body and intersects(a, b))
