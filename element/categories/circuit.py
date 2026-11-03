"""Basic circuit parts: physical terminals and ratings, without analog execution."""
from typing import Annotated, Literal
from pydantic import Field, model_validator
from element.base.contract import Contract
from element.base.quantity import Quantity
from element.base.reference import ObjectRef
from element.categories.base import ComponentDesign
from element.categories.specs import require_positive
from element.interfaces.electrical import ElectricalSpec


class CircuitPartSpec(Contract):
    package: str | None = None


class ResistorSpec(CircuitPartSpec):
    kind: Literal["resistor"] = "resistor"
    resistance: Quantity
    tolerance: float | None = Field(default=None, ge=0, lt=1)
    rated_power: Quantity | None = None

    @model_validator(mode="after")
    def ratings(self):
        require_positive(self.resistance, "resistance", zero=True)
        require_positive(self.rated_power, "power")
        return self


class CapacitorSpec(CircuitPartSpec):
    kind: Literal["capacitor"] = "capacitor"
    capacitance: Quantity
    polarized: bool = False
    voltage_rating: Quantity | None = None

    @model_validator(mode="after")
    def ratings(self):
        require_positive(self.capacitance, "capacitance")
        require_positive(self.voltage_rating, "voltage")
        return self


class InductorSpec(CircuitPartSpec):
    kind: Literal["inductor"] = "inductor"
    inductance: Quantity
    current_rating: Quantity | None = None

    @model_validator(mode="after")
    def ratings(self):
        require_positive(self.inductance, "inductance")
        require_positive(self.current_rating, "current")
        return self


class DiodeSpec(CircuitPartSpec):
    kind: Literal["diode"] = "diode"
    technology: Literal["rectifier", "schottky", "zener"] = "rectifier"
    reverse_voltage: Quantity | None = None
    forward_voltage: Quantity | None = None
    current_rating: Quantity | None = None

    @model_validator(mode="after")
    def ratings(self):
        require_positive(self.reverse_voltage, "voltage")
        require_positive(self.forward_voltage, "voltage", zero=True)
        require_positive(self.current_rating, "current")
        return self


class TransistorSpec(CircuitPartSpec):
    kind: Literal["transistor"] = "transistor"
    technology: Literal["npn", "pnp", "nmos", "pmos"]
    voltage_rating: Quantity | None = None
    current_rating: Quantity | None = None

    @model_validator(mode="after")
    def ratings(self):
        require_positive(self.voltage_rating, "voltage")
        require_positive(self.current_rating, "current")
        return self


class OptocouplerSpec(CircuitPartSpec):
    kind: Literal["optocoupler"] = "optocoupler"
    isolation_voltage: Quantity | None = None
    current_transfer_ratio: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def ratings(self):
        require_positive(self.isolation_voltage, "voltage")
        return self


CircuitSpec = Annotated[ResistorSpec | CapacitorSpec | InductorSpec | DiodeSpec |
                        TransistorSpec | OptocouplerSpec, Field(discriminator="kind")]


class CircuitElement(ComponentDesign):
    category: Literal["circuit_element"] = "circuit_element"
    spec: CircuitSpec
    wiring: ElectricalSpec

    @model_validator(mode="after")
    def pin_contract(self):
        spec = self.spec
        pins = {
            "resistor": {"a", "b"}, "inductor": {"a", "b"},
            "capacitor": {"positive", "negative"} if getattr(spec, "polarized", False) else {"a", "b"},
            "diode": {"anode", "cathode"},
            "transistor": {"base", "collector", "emitter"} if getattr(spec, "technology", None) in ("npn", "pnp") else {"gate", "drain", "source"},
            "optocoupler": {"anode", "cathode", "collector", "emitter"},
        }[spec.kind]
        optional = {"base", "nc"} if spec.kind == "optocoupler" else (
            {"body"} if spec.kind == "transistor" and spec.technology in ("nmos", "pmos") else set())
        if not pins <= set(self.wiring.terminals) <= pins | optional:
            raise ValueError(f"{spec.kind} requires semantic terminals {sorted(pins)}")
        numbers = [t.physical_pin_number for t in self.wiring.terminals.values()]
        if any(not n.strip() for n in numbers) or len(set(numbers)) != len(numbers):
            raise ValueError("Circuit physical pin numbers must be nonempty and distinct")
        for terminal in self.wiring.terminals.values():
            if terminal.electrical_role != "passive" or terminal.drive != "none" or terminal.pull != "none":
                raise ValueError("Circuit pins are passive analog terminals, not ideal digital drivers/pulls")
        return self

    def terminal_ref(self, name: str, *, instance_path=()):
        if name not in self.wiring.terminals:
            raise ValueError(f"Unknown circuit terminal: {name}")
        return ObjectRef(instance_path=instance_path, collection="terminals", object_id=name)
