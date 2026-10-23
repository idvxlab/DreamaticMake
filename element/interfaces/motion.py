from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Contract, Id
from element.base.frame import Pose, Vec3, dot
from element.base.quantity import Quantity, Range
from element.base.reference import ObjectRef


class Joint(Contract):
    kind: Literal["fixed", "revolute", "continuous", "prismatic"]
    parent_body: ObjectRef
    child_body: ObjectRef
    parent_anchor: Pose = Pose()
    child_anchor: Pose = Pose()
    axis: Vec3 | None = None
    position_limit: Range | None = None
    velocity_limit: Quantity | None = None
    effort_limit: Quantity | None = None
    initial_position: Quantity | None = None
    drive_mode: Literal["passive", "position", "velocity"] = "passive"
    evidence_refs: tuple[Id, ...] = ()

    @model_validator(mode="after")
    def semantics(self):
        if self.parent_body.collection != "bodies" or self.child_body.collection != "bodies":
            raise ValueError("Joint endpoints must reference bodies")
        if self.kind == "fixed":
            if any(x is not None for x in (self.axis, self.position_limit, self.velocity_limit, self.effort_limit, self.initial_position)) or self.drive_mode != "passive":
                raise ValueError("Fixed joints cannot have motion fields")
            return self
        if self.axis is None or abs(dot(self.axis, self.axis) - 1) > 1e-6:
            raise ValueError("Moving joints require a unit axis")
        dimension = self.dimension
        if self.kind in ("revolute", "prismatic") and self.position_limit is None:
            raise ValueError("Bounded joints require position limits")
        if self.kind == "continuous" and self.position_limit is not None:
            raise ValueError("Continuous joints cannot have position limits")
        if self.position_limit:
            self.position_limit.min.require(dimension)
        if self.initial_position:
            self.initial_position.require(dimension)
            if self.position_limit and not self.position_limit.contains(self.initial_position):
                raise ValueError("Initial position exceeds limits")
        if self.velocity_limit:
            if self.velocity_limit.require("speed" if dimension == "length" else "angular_speed") <= 0:
                raise ValueError("Velocity limit must be positive")
        if self.effort_limit:
            if self.effort_limit.require("force" if dimension == "length" else "torque") <= 0:
                raise ValueError("Effort limit must be positive")
        return self

    @property
    def dimension(self):
        return "length" if self.kind == "prismatic" else "angle"


class Transmission(Contract):
    kind: Literal["rotary_ratio", "screw"]
    driver_joint: ObjectRef
    follower_joint: ObjectRef
    ratio: float | None = None
    lead_m_per_rev: float | None = None
    offset: Quantity
    evidence_refs: tuple[Id, ...] = ()

    @model_validator(mode="after")
    def consistent(self):
        if self.driver_joint.collection != "joints" or self.follower_joint.collection != "joints":
            raise ValueError("Transmission endpoints must reference joints")
        if self.kind == "rotary_ratio":
            self.offset.require("angle")
            if self.ratio is None or self.ratio == 0 or self.lead_m_per_rev is not None:
                raise ValueError("Rotary transmission requires a nonzero ratio only")
        else:
            self.offset.require("length")
            if self.lead_m_per_rev is None or self.lead_m_per_rev == 0 or self.ratio is not None:
                raise ValueError("Screw transmission requires a nonzero lead only")
        return self


class MotionSpec(Contract):
    joints: dict[Id, Joint] = Field(default_factory=dict)
    transmissions: dict[Id, Transmission] = Field(default_factory=dict)
