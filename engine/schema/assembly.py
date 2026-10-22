from typing import Literal
from pydantic import Field
from engine.base.contract import Contract, Id, Revision
from engine.base.identity import DefinitionRef
from engine.base.quantity import Parameter
from engine.base.reference import ObjectRef
from engine.interface.mechanical import MechanicalConnection
from engine.interface.electrical import ElectricalNet
from engine.interface.material import MaterialConnection
from engine.interface.motion import Joint, Transmission
from engine.schema.component import Definition, ComponentDefinition


class ComponentInstance(Contract):
    definition_ref: DefinitionRef
    parameter_bindings: dict[Id, Parameter] = Field(default_factory=dict)


class Connections(Contract):
    mechanical: dict[Id, MechanicalConnection] = Field(default_factory=dict)
    electrical_nets: dict[Id, ElectricalNet] = Field(default_factory=dict)
    material: dict[Id, MaterialConnection] = Field(default_factory=dict)


class AssemblyDefinition(Definition):
    record_kind: Literal["assembly_definition"] = "assembly_definition"
    instances: dict[Id, ComponentInstance]
    exported_ports: dict[Id, ObjectRef] = Field(default_factory=dict)
    connections: Connections = Field(default_factory=Connections)
    joints: dict[Id, Joint] = Field(default_factory=dict)
    transmissions: dict[Id, Transmission] = Field(default_factory=dict)


class ModelBundle(Contract):
    """Self-contained snapshot input; never a second authoritative project store."""
    dsl_version: Literal["0.2.0-proposal"] = "0.2.0-proposal"
    record_kind: Literal["model_bundle"] = "model_bundle"
    components: tuple[ComponentDefinition, ...] = ()
    assemblies: tuple[AssemblyDefinition, ...] = ()
    root: DefinitionRef
    input_revisions: dict[str, Revision] = Field(default_factory=dict)
