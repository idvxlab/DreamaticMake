from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Id
from element.base.frame import Pose
from element.base.quantity import Parameter


class MechanicalPort(Contract):
    body_ref: Id
    pose: Pose = Pose()
    kind: Literal["threaded_hole", "through_hole", "shaft", "bore", "plane", "clip"]
    allowed_mates: tuple[str, ...] = ()
    dimensions: dict[Id, Parameter] = Field(default_factory=dict)
    thread: str | None = None
    evidence_refs: tuple[Id, ...] = ()


class MechanicalSpec(Contract):
    ports: dict[Id, MechanicalPort] = Field(default_factory=dict)
