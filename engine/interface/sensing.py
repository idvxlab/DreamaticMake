from typing import Literal
from engine.base.contract import Contract, Id, Positive, NonNegative
from engine.base.frame import LocalFrame
from engine.base.reference import ObjectRef
from engine.base.signal import SignalType
from pydantic import Field, model_validator


class SensorSource(Contract):
    kind: Literal["environment", "joint_position"]
    channel: Id | None = None
    joint_ref: ObjectRef | None = None

    @model_validator(mode="after")
    def target(self):
        if self.kind == "environment" and (not self.channel or self.joint_ref):
            raise ValueError("Environment sources require a channel only")
        if self.kind == "joint_position" and (not self.joint_ref or self.channel):
            raise ValueError("Joint sources require a joint_ref only")
        if self.joint_ref and self.joint_ref.collection != "joints":
            raise ValueError("Expected joint reference")
        return self


class SensorInput(Contract):
    quantity: str
    signal_type: SignalType
    location: LocalFrame | None = None
    source: SensorSource
    sample_period_s: float = Field(ge=1e-9)
    latency_s: NonNegative = 0.0
    evidence_refs: tuple[Id, ...] = ()
