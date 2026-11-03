"""A deliberately bounded unit registry, including affine temperatures."""

from math import pi, isfinite
from typing import Literal
from pydantic import model_validator
from element.base.contract import Contract, Id

# dimension, scale to SI, offset to SI, canonical unit
UNITS = {
    "1": ("dimensionless", 1.0, 0.0, "1"),
    "%": ("dimensionless", 0.01, 0.0, "1"),
    "m": ("length", 1.0, 0.0, "m"), "mm": ("length", 0.001, 0.0, "m"),
    "cm": ("length", 0.01, 0.0, "m"),
    "rad": ("angle", 1.0, 0.0, "rad"), "deg": ("angle", pi / 180, 0.0, "rad"),
    "s": ("time", 1.0, 0.0, "s"), "ms": ("time", 0.001, 0.0, "s"),
    "us": ("time", 0.000001, 0.0, "s"),
    "rad/s": ("angular_speed", 1.0, 0.0, "rad/s"),
    "rpm": ("angular_speed", 2 * pi / 60, 0.0, "rad/s"),
    "m/s": ("speed", 1.0, 0.0, "m/s"),
    "m/s2": ("acceleration", 1.0, 0.0, "m/s2"),
    "g0": ("acceleration", 9.80665, 0.0, "m/s2"),
    "T": ("magnetic_flux_density", 1.0, 0.0, "T"),
    "uT": ("magnetic_flux_density", 1e-6, 0.0, "T"),
    "ohm": ("resistance", 1.0, 0.0, "ohm"),
    "kohm": ("resistance", 1e3, 0.0, "ohm"), "Mohm": ("resistance", 1e6, 0.0, "ohm"),
    "F": ("capacitance", 1.0, 0.0, "F"), "uF": ("capacitance", 1e-6, 0.0, "F"),
    "nF": ("capacitance", 1e-9, 0.0, "F"), "pF": ("capacitance", 1e-12, 0.0, "F"),
    "H": ("inductance", 1.0, 0.0, "H"), "mH": ("inductance", 1e-3, 0.0, "H"),
    "uH": ("inductance", 1e-6, 0.0, "H"),
    "C": ("charge", 1.0, 0.0, "C"), "Ah": ("charge", 3600.0, 0.0, "C"),
    "mAh": ("charge", 3.6, 0.0, "C"),
    "V": ("voltage", 1.0, 0.0, "V"), "mV": ("voltage", 0.001, 0.0, "V"),
    "A": ("current", 1.0, 0.0, "A"), "mA": ("current", 0.001, 0.0, "A"),
    "K": ("temperature", 1.0, 0.0, "K"), "degC": ("temperature", 1.0, 273.15, "K"),
    "kg": ("mass", 1.0, 0.0, "kg"), "g": ("mass", 0.001, 0.0, "kg"),
    "kg/s": ("mass_flow", 1.0, 0.0, "kg/s"),
    "Pa": ("pressure", 1.0, 0.0, "Pa"), "kPa": ("pressure", 1000.0, 0.0, "Pa"),
    "W": ("power", 1.0, 0.0, "W"), "N": ("force", 1.0, 0.0, "N"),
    "N*m": ("torque", 1.0, 0.0, "N*m"), "Hz": ("frequency", 1.0, 0.0, "Hz"),
    "m3/s": ("volume_flow", 1.0, 0.0, "m3/s"),
}


class Quantity(Contract):
    value: float
    unit: str

    @model_validator(mode="after")
    def check_unit(self):
        if self.unit not in UNITS:
            raise ValueError(f"Unsupported unit: {self.unit}")
        if not isfinite(self.si_value):
            raise ValueError("Unit conversion overflow")
        if self.dimension == "temperature" and self.si_value < 0:
            raise ValueError("Absolute temperature cannot be negative")
        return self

    @property
    def dimension(self) -> str:
        return UNITS[self.unit][0]

    @property
    def si_value(self) -> float:
        _, scale, offset, _ = UNITS[self.unit]
        return self.value * scale + offset

    def to(self, unit: str) -> "Quantity":
        if unit not in UNITS or UNITS[unit][0] != self.dimension:
            raise ValueError(f"Incompatible units: {self.unit}, {unit}")
        _, scale, offset, _ = UNITS[unit]
        return Quantity(value=(self.si_value - offset) / scale, unit=unit)

    def require(self, dimension: str) -> float:
        if self.dimension != dimension:
            raise ValueError(f"Expected {dimension}, got {self.dimension}")
        return self.si_value


class Range(Contract):
    min: Quantity
    max: Quantity

    @model_validator(mode="after")
    def ordered(self):
        if self.min.dimension != self.max.dimension or self.min.si_value > self.max.si_value:
            raise ValueError("Range needs compatible, ordered endpoints")
        return self

    def contains(self, value: Quantity) -> bool:
        return value.dimension == self.min.dimension and self.min.si_value <= value.si_value <= self.max.si_value


class Parameter(Contract):
    status: Literal["known", "assumed", "unknown"]
    value: Quantity | None = None
    range: Range | None = None
    configurable: bool = False
    evidence_refs: tuple[Id, ...] = ()
    conditions: str = ""

    @model_validator(mode="after")
    def consistent(self):
        if self.status == "unknown" and self.value is not None:
            raise ValueError("Unknown parameters cannot have values")
        if self.status != "unknown" and self.value is None:
            raise ValueError("Known/assumed parameters require a value")
        if self.value and self.range and not self.range.contains(self.value):
            raise ValueError("Parameter value is outside its range")
        return self
