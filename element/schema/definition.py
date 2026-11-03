"""Common metadata for reusable definitions; no execution representation."""
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Id, Revision
from element.base.evidence import Evidence, SourceRecord
from element.base.quantity import Parameter
from element.interfaces.function import FunctionSpec, PrincipleSpec, Realization


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
