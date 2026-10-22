"""Rigid transforms. Quaternions are [x, y, z, w]."""

from math import cos, sin, sqrt
from pydantic import model_validator
from engine.base.contract import Contract, Id

Vec3 = tuple[float, float, float]
Quaternion = tuple[float, float, float, float]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def scale(a, factor):
    return tuple(x * factor for x in a)


def multiply(a: Quaternion, b: Quaternion) -> Quaternion:
    v = add(add(scale(b[:3], a[3]), scale(a[:3], b[3])), cross(a[:3], b[:3]))
    return (*v, a[3] * b[3] - dot(a[:3], b[:3]))


def rotate(q: Quaternion, v: Vec3) -> Vec3:
    t = scale(cross(q[:3], v), 2.0)
    return add(v, add(scale(t, q[3]), cross(q[:3], t)))


class Pose(Contract):
    translation_m: Vec3 = (0.0, 0.0, 0.0)
    rotation_xyzw: Quaternion = (0.0, 0.0, 0.0, 1.0)

    @model_validator(mode="after")
    def normalized(self):
        if abs(dot(self.rotation_xyzw, self.rotation_xyzw) - 1.0) > 1e-6:
            raise ValueError("Quaternion must have unit length")
        return self

    def compose(self, other: "Pose") -> "Pose":
        q = multiply(self.rotation_xyzw, other.rotation_xyzw)
        norm = sqrt(dot(q, q))
        return Pose(translation_m=add(self.translation_m, rotate(self.rotation_xyzw, other.translation_m)),
                    rotation_xyzw=tuple(x / norm for x in q))

    def inverse(self) -> "Pose":
        x, y, z, w = self.rotation_xyzw
        q = (-x, -y, -z, w)
        return Pose(translation_m=rotate(q, scale(self.translation_m, -1)), rotation_xyzw=q)

    @classmethod
    def axis_angle(cls, axis: Vec3, angle: float) -> "Pose":
        return cls(rotation_xyzw=(*scale(axis, sin(angle / 2)), cos(angle / 2)))


class LocalFrame(Contract):
    body_ref: Id
    pose: Pose = Pose()
