from typing import Annotated, Literal
from pydantic import Field
from element.base.contract import Contract, Id
from element.base.frame import LocalFrame
from element.base.reference import ObjectRef
from element.base.signal import SignalType


class BehaviorOutputRef(Contract):
    behavior_id: Id
    output: Id = "value"


class MotionEffect(Contract):
    kind: Literal["motion"] = "motion"
    target_joint: ObjectRef
    mode: Literal["position", "velocity"]
    value_type: SignalType
    behavior_output_ref: BehaviorOutputRef


class ObservableEffect(Contract):
    kind: Literal["light", "sound", "heat", "display", "transport"]
    location: LocalFrame | None = None
    value_type: SignalType
    behavior_output_ref: BehaviorOutputRef
    model_ref: str | None = None


EffectOutput = Annotated[MotionEffect | ObservableEffect, Field(discriminator="kind")]
