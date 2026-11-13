from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Contract, Id
from element.base.frame import Pose
from element.base.quantity import Quantity, Range


class TerminalProperties(Contract):
    physical_pin_number: str
    label: str = ""
    electrical_role: Literal["power_in", "power_out", "ground", "input", "output", "bidirectional", "passive"]
    drive: Literal["push_pull", "open_drain", "none"] = "none"
    pull: Literal["up", "down", "none"] = "none"
    voltage_limits: Range | None = None
    nominal_voltage: Quantity | None = None
    current_limits: Range | None = None

    @model_validator(mode="after")
    def dimensions(self):
        for bounds, dimension in ((self.voltage_limits, "voltage"), (self.current_limits, "current")):
            if bounds:
                for endpoint in (bounds.min, bounds.max):
                    if endpoint: endpoint.require(dimension)
        if self.nominal_voltage:
            self.nominal_voltage.require("voltage")
            if self.electrical_role != "power_out":
                raise ValueError("Only ideal power outputs declare nominal voltage")
        if self.drive != "none" and self.electrical_role not in ("output", "bidirectional"):
            raise ValueError("Only signal outputs can drive digital networks")
        return self


class Terminal(TerminalProperties):
    body_ref: Id | None = None
    pose: Pose | None = None
    reference_terminal: Id | None = None
    evidence_refs: tuple[Id, ...] = ()

    @model_validator(mode="after")
    def terminal_frame_valid(self):
        if self.pose and not self.body_ref:
            raise ValueError("Terminal poses require a body")
        return self


class Connector(Contract):
    body_ref: Id
    pose: Pose | None = None
    family: str | None = None
    keyed: bool = False
    pin_map: dict[str, Id]


class ElectricalSpec(Contract):
    terminals: dict[Id, Terminal] = Field(default_factory=dict)
    connectors: dict[Id, Connector] = Field(default_factory=dict)
