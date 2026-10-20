from typing import Literal
from pydantic import Field
from engine.base.contract import Contract, Id
from engine.base.quantity import Parameter
from engine.base.signal import SignalType


class ElectricalInterface(Contract):
    protocol: Literal["digital", "analog_sample", "pwm", "i2c_transaction", "uart_transaction"]
    terminal_bindings: dict[Id, Id] = Field(default_factory=dict)
    inputs: dict[Id, SignalType] = Field(default_factory=dict)
    outputs: dict[Id, SignalType] = Field(default_factory=dict)
    supply_terminals: tuple[Id, ...] = ()
    reference_terminal: Id | None = None
    timing: dict[Id, Parameter] = Field(default_factory=dict)
    behavior_ref: Id
    evidence_refs: tuple[Id, ...] = ()
