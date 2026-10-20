from typing import Annotated, Literal
from pydantic import Field
from engine.base.contract import Contract, Id, Positive
from engine.base.frame import Pose
from engine.base.quantity import Parameter
from engine.base.reference import ObjectRef


class CircularAperture(Contract):
    kind: Literal["circle"] = "circle"
    diameter_m: Positive


class RectangularAperture(Contract):
    kind: Literal["rectangle"] = "rectangle"
    width_m: Positive
    height_m: Positive


Aperture = Annotated[CircularAperture | RectangularAperture, Field(discriminator="kind")]


class MaterialPort(Contract):
    body_ref: Id
    pose: Pose = Pose()
    medium_kind: Literal["gas", "liquid", "granular"]
    medium_ref: Id
    direction: Literal["in", "out", "bidirectional"]
    aperture: Aperture
    connector: str | None = None
    limits: dict[Id, Parameter] = Field(default_factory=dict)
    evidence_refs: tuple[Id, ...] = ()


class MaterialPath(Contract):
    inlet_port: Id
    outlet_port: Id
    mechanism: Literal["passive", "fan", "pump", "auger", "valve"]
    transport_model_ref: str | None = None
    capacity: Parameter | None = None
    drive_effect_ref: Id | None = None


class MaterialConnection(Contract):
    a: ObjectRef
    b: ObjectRef
    loss_model_ref: str | None = None


class MaterialSpec(Contract):
    ports: dict[Id, MaterialPort] = Field(default_factory=dict)
    paths: dict[Id, MaterialPath] = Field(default_factory=dict)
