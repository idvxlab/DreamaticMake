from typing import Literal
from element.base.quantity import Quantity
from element.base.reference import ObjectRef
from element.interfaces.electrical import ElectricalSpec, Terminal
from element.categories.base import ComponentDesign
from element.categories.specs import PowerDescription
from pydantic import model_validator


class PowerSource(ComponentDesign):
    category: Literal["power"] = "power"
    source_kind: Literal["ideal_supply", "battery", "usb"]
    voltage: Quantity
    spec: PowerDescription | None = None
    wiring: ElectricalSpec | None = None

    @model_validator(mode="after")
    def positive_voltage(self):
        if self.voltage.require("voltage") <= 0:
            raise ValueError("Supply voltage must be positive")
        if self.spec and self.source_kind != "battery" and (self.spec.capacity is not None or self.spec.chemistry is not None):
            raise ValueError("Capacity/chemistry describe battery sources only")
        if self.wiring is not None:
            if set(self.wiring.terminals) != {"positive", "ground"}:
                raise ValueError("Power wiring requires positive and ground terminals")
            positive, ground = self.wiring.terminals["positive"], self.wiring.terminals["ground"]
            if positive.electrical_role != "power_out" or ground.electrical_role != "ground":
                raise ValueError("Power terminal roles must be power_out and ground")
            if positive.reference_terminal not in (None, "ground"):
                raise ValueError("Positive power terminal must reference ground")
            if positive.nominal_voltage and abs(positive.nominal_voltage.si_value - self.voltage.si_value) > 1e-9:
                raise ValueError("Positive terminal voltage conflicts with source voltage")
        return self

    @property
    def electrical(self):
        """Effective local terminals, shared by occurrence views and execution lowering."""
        if self.wiring is not None:
            positive = Terminal.model_validate({**dict(self.wiring.terminals["positive"]),
                "nominal_voltage": self.voltage, "reference_terminal": "ground"})
            return ElectricalSpec(terminals={**self.wiring.terminals, "positive": positive},
                                  connectors=self.wiring.connectors)
        return ElectricalSpec(terminals={
            "positive": Terminal(physical_pin_number="+", electrical_role="power_out",
                nominal_voltage=self.voltage, reference_terminal="ground"),
            "ground": Terminal(physical_pin_number="-", electrical_role="ground")})

    def terminal_ref(self, name: Literal["positive", "ground"], *, instance_path=()):
        if name not in ("positive", "ground"):
            raise ValueError("Power source has positive and ground terminals")
        return ObjectRef(instance_path=instance_path, collection="terminals", object_id=name)
