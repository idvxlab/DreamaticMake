from typing import Literal
from pydantic import Field, model_validator
from engine.base.contract import Contract, Id
from engine.base.frame import Pose
from engine.base.quantity import Quantity, Range
from engine.base.reference import ObjectRef


class Terminal(Contract):
    body_ref: Id | None = None
    pose: Pose | None = None
    physical_pin_number: str
    label: str = ""
    electrical_role: Literal["power_in", "power_out", "ground", "input", "output", "bidirectional", "passive"]
    drive: Literal["push_pull", "open_drain", "none"] = "none"
    pull: Literal["up", "down", "none"] = "none"
    voltage_limits: Range | None = None
    nominal_voltage: Quantity | None = None
    current_limits: Range | None = None
    reference_terminal: Id | None = None
    evidence_refs: tuple[Id, ...] = ()

    @model_validator(mode="after")
    def dimensions(self):
        if self.voltage_limits:
            self.voltage_limits.min.require("voltage")
        if self.nominal_voltage:
            self.nominal_voltage.require("voltage")
            if self.electrical_role != "power_out":
                raise ValueError("Only ideal power outputs declare nominal voltage")
        if self.current_limits:
            self.current_limits.min.require("current")
        if self.drive != "none" and self.electrical_role not in ("output", "bidirectional"):
            raise ValueError("Only signal outputs can drive digital networks")
        if self.pose and not self.body_ref:
            raise ValueError("Terminal poses require a body")
        return self


class Connector(Contract):
    body_ref: Id
    pose: Pose | None = None
    family: str | None = None
    keyed: bool = False
    pin_map: dict[str, Id]


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


class ElectricalSpec(Contract):
    terminals: dict[Id, Terminal] = Field(default_factory=dict)
    connectors: dict[Id, Connector] = Field(default_factory=dict)
