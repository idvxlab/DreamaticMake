from typing import Annotated, Literal
from pydantic import Field, model_validator
from element.base.contract import Contract, Id, Positive, NonNegative
from element.base.frame import Pose
from element.base.quantity import Parameter
from element.base.reference import AssetRef


class Box(Contract):
    kind: Literal["box"] = "box"
    size_m: tuple[Positive, Positive, Positive]


class Sphere(Contract):
    kind: Literal["sphere"] = "sphere"
    radius_m: Positive


class Cylinder(Contract):
    kind: Literal["cylinder"] = "cylinder"
    radius_m: Positive
    length_m: Positive


class Capsule(Contract):
    kind: Literal["capsule"] = "capsule"
    radius_m: Positive
    segment_length_m: Positive


class ConvexAsset(Contract):
    kind: Literal["convex_asset"] = "convex_asset"
    asset_ref: AssetRef


class TriangleMesh(Contract):
    kind: Literal["triangle_mesh"] = "triangle_mesh"
    asset_ref: AssetRef
    # STL has no unit metadata: require the caller to declare it.
    unit: Literal["m", "cm", "mm"]
    collision_mode: Literal["surface", "solid"] = "surface"


Shape = Annotated[Box | Sphere | Cylinder | Capsule | ConvexAsset | TriangleMesh, Field(discriminator="kind")]


class RigidBody(Contract):
    description: str = ""
    mass: Parameter | None = None
    inertia_ref: AssetRef | None = None

    @model_validator(mode="after")
    def mass_dimension(self):
        if self.mass:
            if self.mass.value and self.mass.value.require("mass") <= 0:
                raise ValueError("Known rigid-body mass must be positive")
            if self.mass.range and self.mass.range.min.require("mass") < 0:
                raise ValueError("Mass range cannot include negative mass")
        return self


class Envelope(Contract):
    body_ref: Id
    pose: Pose = Pose()
    shape: Shape
    purpose: Literal["solid", "keepout", "service"] = "solid"
    approximation: Literal["outer", "inner", "unknown"] = "unknown"
    margin_m: NonNegative = 0.0
    evidence_refs: tuple[Id, ...] = ()


class VisualAsset(Contract):
    body_ref: Id
    pose: Pose = Pose()
    asset_ref: AssetRef


class GeometrySpec(Contract):
    root_body: Id | None = None
    bodies: dict[Id, RigidBody] = Field(default_factory=dict)
    envelopes: dict[Id, Envelope] = Field(default_factory=dict)
    visual_assets: dict[Id, VisualAsset] = Field(default_factory=dict)
