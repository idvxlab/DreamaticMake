"""Normalized compiler/simulator input, derived from element category definitions."""
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Id
from element.interfaces.geometry import GeometrySpec
from element.interfaces.motion import MotionSpec
from element.interfaces.mechanical import MechanicalSpec
from element.interfaces.material import MaterialSpec
from element.interfaces.electrical import ElectricalSpec
from element.interfaces.electronic import ElectricalInterface
from element.interfaces.sensing import SensorInput
from element.interfaces.effects import EffectOutput
from element.interfaces.behavior import BehaviorSpec
from element.schema.definition import Definition


class PhysicalSpec(Contract):
    geometry: GeometrySpec = Field(default_factory=GeometrySpec)
    motion: MotionSpec = Field(default_factory=MotionSpec)
    mechanical: MechanicalSpec = Field(default_factory=MechanicalSpec)
    material: MaterialSpec = Field(default_factory=MaterialSpec)


class ElectronicSpec(Contract):
    electrical: ElectricalSpec = Field(default_factory=ElectricalSpec)
    interfaces: dict[Id, ElectricalInterface] = Field(default_factory=dict)
    sensors: dict[Id, SensorInput] = Field(default_factory=dict)
    effects: dict[Id, EffectOutput] = Field(default_factory=dict)


class ComponentDefinition(Definition):
    record_kind: Literal["component_definition"] = "component_definition"
    physical: PhysicalSpec = Field(default_factory=PhysicalSpec)
    electronic: ElectronicSpec = Field(default_factory=ElectronicSpec)
    behaviors: dict[Id, BehaviorSpec] = Field(default_factory=dict)
