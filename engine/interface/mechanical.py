from typing import Literal
from pydantic import Field, model_validator
from engine.base.contract import Contract, Id
from engine.base.frame import Pose
from engine.base.quantity import Parameter
from engine.base.reference import ObjectRef


class MechanicalPort(Contract):
    body_ref: Id
    pose: Pose = Pose()
    kind: Literal["threaded_hole", "through_hole", "shaft", "bore", "plane", "clip"]
    allowed_mates: tuple[str, ...] = ()
    dimensions: dict[Id, Parameter] = Field(default_factory=dict)
    thread: str | None = None
    evidence_refs: tuple[Id, ...] = ()


class MechanicalConnection(Contract):
    a: ObjectRef
    b: ObjectRef
    method: Literal["fastener", "press_fit", "adhesive", "bearing", "contact"]
    constraint_mode: Literal["fixed", "joint", "contact"]
    alignment: Pose = Pose()
    joint_ref: ObjectRef | None = None
    assumptions: tuple[str, ...] = ()

    @model_validator(mode="after")
    def joint_binding(self):
        if self.a.collection != "mechanical_ports" or self.b.collection != "mechanical_ports":
            raise ValueError("Mechanical connections require mechanical ports")
        if (self.constraint_mode == "joint") != (self.joint_ref is not None):
            raise ValueError("Only joint connections require a joint_ref")
        if self.joint_ref and self.joint_ref.collection != "joints":
            raise ValueError("joint_ref must reference a joint")
        return self


class MechanicalSpec(Contract):
    ports: dict[Id, MechanicalPort] = Field(default_factory=dict)
