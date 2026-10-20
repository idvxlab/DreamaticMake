from typing import Literal
from pydantic import model_validator
from engine.base.contract import Contract, NonNegative
from engine.base.quantity import UNITS

LogicValue = Literal["0", "1", "X", "Z"]
SignalValue = float | bool | str | None


def channel_key(scope, name, channels):
    """Instance-local fixtures override a deliberately shared global fixture."""
    scoped = "/".join((*scope, name))
    return scoped if scoped in channels else name


class SignalType(Contract):
    kind: Literal["scalar", "digital", "boolean", "event", "image", "data"]
    unit: str | None = None
    protocol: str | None = None

    @model_validator(mode="after")
    def units(self):
        if self.kind == "scalar" and self.unit not in UNITS:
            raise ValueError("Scalar signals require a supported unit")
        if self.kind != "scalar" and self.unit is not None:
            raise ValueError("Only scalar signals have units")
        return self


class Sample(Contract):
    value: SignalValue = None
    time_s: NonNegative
    quality: Literal["valid", "unknown", "stale", "fault"] = "unknown"
    origin: Literal["fixture", "simulated", "measured"] = "simulated"

    @model_validator(mode="after")
    def validity(self):
        if self.quality == "valid" and self.value is None:
            raise ValueError("Valid samples require a value")
        return self
