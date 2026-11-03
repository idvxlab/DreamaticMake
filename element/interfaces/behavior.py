"""Closed, declarative model registry contracts; never an import path or script."""

from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Contract, Id
from element.base.quantity import Quantity
from element.base.reference import ObjectRef
from element.base.signal import SignalType, SignalValue


class InputBinding(Contract):
    kind: Literal["terminal", "sensor", "behavior", "fixture", "constant"]
    ref: ObjectRef | None = None
    channel: Id | None = None
    value: SignalValue = None
    output: Id = "value"

    @model_validator(mode="after")
    def target(self):
        if self.kind in ("terminal", "sensor", "behavior"):
            expected = {"terminal": "terminals", "sensor": "sensors", "behavior": "behaviors"}[self.kind]
            if not self.ref or self.ref.collection != expected or self.channel or self.value is not None:
                raise ValueError("Reference input needs exactly one correctly typed ref")
        elif self.kind == "fixture":
            if not self.channel or self.ref or self.value is not None:
                raise ValueError("Fixture input needs a channel only")
        elif self.value is None or self.ref or self.channel:
            raise ValueError("Constant input needs a value only")
        return self


class Transition(Contract):
    from_state: Id
    to_state: Id
    event: Id


class BehaviorProgram(Contract):
    kind: Literal["builtin", "state_machine"] = "builtin"
    model_id: Id
    model_version: Literal["1"] = "1"
    output_type: SignalType
    parameters: dict[Id, Quantity] = Field(default_factory=dict)
    initial_state: Id | None = None
    states: dict[Id, SignalValue] = Field(default_factory=dict)
    transitions: tuple[Transition, ...] = ()
    assumptions: tuple[str, ...] = ()

    @model_validator(mode="after")
    def state_machine(self):
        if self.kind == "state_machine":
            if self.model_id != "state_machine" or self.initial_state not in self.states:
                raise ValueError("State machines need a valid initial state and model_id")
            seen = set()
            for t in self.transitions:
                key = (t.from_state, t.event)
                if t.from_state not in self.states or t.to_state not in self.states or key in seen:
                    raise ValueError("Invalid or ambiguous state transition")
                seen.add(key)
        elif self.initial_state or self.states or self.transitions:
            raise ValueError("State declarations require state_machine kind")
        return self


class BehaviorSpec(BehaviorProgram):
    inputs: dict[Id, InputBinding] = Field(default_factory=dict)
    output_terminals: tuple[Id, ...] = ()
    supply_terminals: tuple[Id, ...] = ()
