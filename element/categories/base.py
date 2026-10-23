"""Typed authoring contracts; lower into the stable execution DSL, never plug-ins."""
from element.base.contract import Id
from element.base.identity import DefinitionRef
from element.base.evidence import SourceRecord
from element.interfaces.geometry import GeometrySpec
from element.interfaces.mechanical import MechanicalSpec
from element.interfaces.function import FunctionSpec
from element.schema.model import Definition, ComponentDefinition, PhysicalSpec, ElectronicSpec
from pydantic import BaseModel, Field, model_serializer, model_validator
from element.base.frame import LocalFrame
from typing import Literal


class ComponentDesign(Definition):
    record_kind: Literal["component_design"] = "component_design"
    design_version: Literal["1"] = "1"
    roles: tuple[Id, ...] = ()
    geometry: GeometrySpec = Field(default_factory=GeometrySpec)
    mounts: MechanicalSpec = Field(default_factory=MechanicalSpec)

    @model_serializer(mode="wrap")
    def omit_absent_extensions(self, handler):
        # Optional additions must not change legacy design provenance or snapshots.
        record = handler(self)
        for name in ("spec", "wiring"):
            if getattr(self, name, None) is None:
                record.pop(name, None)
        return record

    @model_validator(mode="after")
    def description_frames(self):
        def visit(value):
            if isinstance(value, LocalFrame) and value.body_ref not in self.geometry.bodies:
                raise ValueError("Description frame must reference an existing local body")
            if isinstance(value, BaseModel):
                for name in type(value).model_fields:
                    visit(getattr(value, name))
            elif isinstance(value, dict):
                for child in value.values():
                    visit(child)
            elif isinstance(value, (tuple, list)):
                for child in value:
                    visit(child)
        visit(getattr(self, "spec", None))
        return self

    def replace(self, **changes):
        """Validated immutable edit, unlike unchecked model_copy(update=...)."""
        return type(self).model_validate({**dict(self), **changes})
