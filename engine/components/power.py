from typing import Literal
from engine.base.quantity import Quantity
from engine.base.reference import ObjectRef
from engine.interface.electrical import Terminal, ElectricalSpec
from engine.components.base import ComponentDesign
from pydantic import model_validator


class PowerSource(ComponentDesign):
    category: Literal["power"] = "power"
    source_kind: Literal["ideal_supply", "battery", "usb"]
    voltage: Quantity

    @model_validator(mode="after")
    def positive_voltage(self):
        if self.voltage.require("voltage") <= 0:
            raise ValueError("Supply voltage must be positive")
        return self

    def terminal_ref(self, name: Literal["positive", "ground"], *, instance_path=()):
        if name not in ("positive", "ground"):
            raise ValueError("Power source has positive and ground terminals")
        return ObjectRef(instance_path=instance_path, collection="terminals", object_id=name)

    def _lower(self):
        return self._definition(electrical=ElectricalSpec(terminals={
            "positive": Terminal(physical_pin_number="+", electrical_role="power_out",
                nominal_voltage=self.voltage, reference_terminal="ground"),
            "ground": Terminal(physical_pin_number="-", electrical_role="ground")}))
