from typing import Annotated, Literal
from pydantic import Field
from element.base.contract import Contract, Id, Positive
from element.base.frame import Pose
from element.base.quantity import Parameter


class CircularAperture(Contract):
    kind: Literal["circle"] = "circle"
    diameter_m: Positive


class RectangularAperture(Contract):
    kind: Literal["rectangle"] = "rectangle"
    width_m: Positive
    height_m: Positive


Aperture = Annotated[CircularAperture | RectangularAperture, Field(discriminator="kind")]


class MaterialPortProperties(Contract):
    medium_kind: Literal["gas", "liquid", "granular"]
    aperture: Aperture
    connector: str | None = None
    limits: dict[Id, Parameter] = Field(default_factory=dict)


class MaterialPort(MaterialPortProperties):
    body_ref: Id
    pose: Pose = Pose()
    medium_ref: Id
    direction: Literal["in", "out", "bidirectional"]
    evidence_refs: tuple[Id, ...] = ()


class MaterialPath(Contract):
    inlet_port: Id
    outlet_port: Id
    mechanism: Literal["passive", "fan", "pump", "auger", "valve"]
    transport_model_ref: str | None = None
    capacity: Parameter | None = None
    drive_effect_ref: Id | None = None


class MaterialSpec(Contract):
    ports: dict[Id, MaterialPort] = Field(default_factory=dict)
    paths: dict[Id, MaterialPath] = Field(default_factory=dict)
