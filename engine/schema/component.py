from typing import Literal
from pydantic import Field
from engine.base.contract import Contract, Id, Revision
from engine.base.evidence import Evidence, SourceRecord
from engine.base.quantity import Parameter
from engine.interface.geometry import GeometrySpec
from engine.interface.motion import MotionSpec
from engine.interface.mechanical import MechanicalSpec
from engine.interface.material import MaterialSpec
from engine.interface.electrical import ElectricalSpec
from engine.interface.electronic import ElectricalInterface
from engine.interface.sensing import SensorInput
from engine.interface.effects import EffectOutput
from engine.interface.behavior import BehaviorSpec
from engine.interface.function import FunctionSpec, PrincipleSpec, Realization


class Definition(Contract):
    dsl_version: Literal["0.2.0-proposal"] = "0.2.0-proposal"
    id: Id
    revision: Revision = 1
    name: str
    parameters: dict[Id, Parameter] = Field(default_factory=dict)
    functions: dict[Id, FunctionSpec] = Field(default_factory=dict)
    principles: dict[Id, PrincipleSpec] = Field(default_factory=dict)
    realizations: dict[Id, Realization] = Field(default_factory=dict)
    sources: dict[Id, SourceRecord] = Field(default_factory=dict)
    evidence: dict[Id, Evidence] = Field(default_factory=dict)


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
