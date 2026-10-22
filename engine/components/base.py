"""Typed authoring contracts; lower into the stable execution DSL, never plug-ins."""
from engine.base.contract import Id
from engine.base.identity import DefinitionRef
from engine.base.evidence import SourceRecord
from engine.interface.geometry import GeometrySpec
from engine.interface.mechanical import MechanicalSpec
from engine.interface.function import FunctionSpec
from engine.schema.component import Definition, ComponentDefinition, PhysicalSpec, ElectronicSpec
from engine.schema.assembly import ModelBundle
from pydantic import BaseModel, Field, model_serializer, model_validator
from engine.base.frame import LocalFrame
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

    def to_definition(self) -> ComponentDefinition:
        # Even direct Python calls must not bypass authoring validation.
        design = type(self).model_validate_json(self.model_dump_json())
        return design._lower()

    def to_bundle(self) -> ModelBundle:
        from engine.io.save import content_hash
        definition = self.to_definition()
        return ModelBundle(components=(definition,), root=DefinitionRef(
            id=definition.id, revision=definition.revision, content_hash=content_hash(definition)))

    def _definition(self, *, motion=None, material=None, electrical=None,
                    sensors=None, effects=None, behaviors=None, interfaces=None,
                    functions=None, extra_sources=None):
        from engine.io.save import content_hash
        if "_component_design" in self.sources or "_category" in self.functions:
            raise ValueError("_component_design and _category are reserved authoring keys")
        sources = {**self.sources, **(extra_sources or {}), "_component_design": SourceRecord(
            title=f"Component design v{self.design_version}: {self.category}",
            source_revision=content_hash(self), locator=f"category={self.category}")}
        capabilities = {**self.functions, "_category": FunctionSpec(
            capability=f"component.{self.category}", operating_conditions=self.roles)}
        spec = getattr(self, "spec", None)
        if spec is not None:
            if "_description" in self.functions:
                raise ValueError("_description is reserved for typed authoring descriptions")
            capabilities["_description"] = FunctionSpec(
                capability=f"description.{self.category}.{getattr(spec, 'kind', self.category)}",
                operating_conditions=("Typed source description; no additional physical solver executed",))
        for key, value in (functions or {}).items():
            if key in capabilities:
                raise ValueError(f"Duplicate function ID: {key}")
            capabilities[key] = value
        physical = {"geometry": self.geometry, "mechanical": self.mounts}
        if motion is not None:
            physical["motion"] = motion
        if material is not None:
            physical["material"] = material
        return ComponentDefinition(
            id=self.id, revision=self.revision, name=self.name, parameters=self.parameters,
            functions=capabilities, principles=self.principles, realizations=self.realizations,
            sources=sources, evidence=self.evidence,
            physical=PhysicalSpec(**physical),
            electronic=ElectronicSpec(**({"electrical": electrical} if electrical is not None else {}),
                sensors=sensors or {}, effects=effects or {}, interfaces=interfaces or {}),
            behaviors=behaviors or {})

    def _lower(self):
        raise NotImplementedError("Use a concrete component category")
