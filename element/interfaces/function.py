from pydantic import Field
from element.base.contract import Contract, Id
from element.base.signal import SignalType
from element.base.reference import ObjectRef


class FunctionSpec(Contract):
    capability: str
    inputs: dict[Id, SignalType] = Field(default_factory=dict)
    outputs: dict[Id, SignalType] = Field(default_factory=dict)
    operating_conditions: tuple[str, ...] = ()
    acceptance_refs: tuple[str, ...] = ()


class PrincipleSpec(Contract):
    mechanism: str
    input_domains: tuple[str, ...] = ()
    output_domains: tuple[str, ...] = ()
    behavior_refs: tuple[Id, ...] = ()
    assumptions: tuple[str, ...] = ()


class Realization(Contract):
    function_ref: Id
    principle_refs: tuple[Id, ...] = ()
    object_refs: tuple[ObjectRef, ...] = ()
