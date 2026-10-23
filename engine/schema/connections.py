"""Cross-instance assembly connections; local element ports live in element.interfaces."""
from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Contract, Id
from element.base.frame import Pose
from element.base.reference import ObjectRef

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

class ElectricalNet(Contract):
    members: tuple[ObjectRef, ...] = Field(min_length=2)
    kind: Literal["signal", "power", "ground"] = "signal"
    reference_net: Id | None = None
    evidence_refs: tuple[Id, ...] = ()

    @model_validator(mode="after")
    def terminals_only(self):
        if any(x.collection != "terminals" for x in self.members):
            raise ValueError("Electrical networks require terminal references")
        if len({x.key() for x in self.members}) != len(self.members):
            raise ValueError("Duplicate terminal in network")
        return self

class MaterialConnection(Contract):
    a: ObjectRef
    b: ObjectRef
    loss_model_ref: str | None = None
