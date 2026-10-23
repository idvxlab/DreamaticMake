from pathlib import Path
from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Positive
from element.base.quantity import Quantity, Range
from element.base.reference import AssetRef, ObjectRef
from element.interfaces.geometry import GeometrySpec, Shape, RigidBody, Envelope, TriangleMesh, VisualAsset
from element.interfaces.motion import Joint, MotionSpec
from element.interfaces.material import MaterialSpec
from element.interfaces.behavior import BehaviorSpec
from element.interfaces.electrical import ElectricalSpec
from element.interfaces.effects import MotionEffect, BehaviorOutputRef
from element.categories.base import ComponentDesign
from element.categories.specs import MechanicalDescription, ActuatorDescription, require_positive


class Structure(ComponentDesign):
    category: Literal["structure"] = "structure"
    structural_role: Literal["housing", "bracket", "blade", "pointer", "diffuser", "other"] = "other"
    spec: MechanicalDescription | None = None

    @classmethod
    def from_shape(cls, *, id: str, name: str, shape: Shape, **kwargs):
        return cls(id=id, name=name, geometry=GeometrySpec(root_body="body",
            bodies={"body": RigidBody()}, envelopes={"solid": Envelope(body_ref="body", shape=shape)}), **kwargs)

    @classmethod
    def from_stl(cls, *, id: str, name: str, path: str | Path, asset_root: str | Path,
                 unit: Literal["m", "cm", "mm"], collision_mode="surface", **kwargs):
        """Explicit bounded STL import. Optional mesh dependencies validate original bytes."""
        import hashlib
        from element.io.load import read_asset
        from element.io.mesh import MAX_STL_BYTES, resolve_stl
        root, target = Path(asset_root).resolve(strict=True), Path(path).resolve(strict=True)
        if not target.is_relative_to(root):
            raise ValueError("STL must be inside the explicit asset root")
        with target.open("rb") as stream:
            data = stream.read(MAX_STL_BYTES + 1)
        if len(data) > MAX_STL_BYTES:
            raise ValueError("STL exceeds size limit")
        asset = AssetRef(relative_path=target.relative_to(root).as_posix(),
                        sha256=hashlib.sha256(data).hexdigest(), media_type="model/stl")
        shape = TriangleMesh(asset_ref=asset, unit=unit, collision_mode=collision_mode)
        # Verify the same confined reference consumers will use, including solid semantics.
        resolve_stl(shape, lambda ref: read_asset(ref, root, MAX_STL_BYTES))
        return cls.from_shape(id=id, name=name, shape=shape, **kwargs)

    @classmethod
    def from_visual(cls, *, id: str, name: str, asset: AssetRef, envelope: Shape, **kwargs):
        """CAD/display asset reference plus an explicit independent collision envelope."""
        return cls(id=id, name=name, geometry=GeometrySpec(root_body="body", bodies={"body": RigidBody()},
            visual_assets={"visual": VisualAsset(body_ref="body", asset_ref=asset)},
            envelopes={"solid": Envelope(body_ref="body", shape=envelope)}), **kwargs)


class Actuator(ComponentDesign):
    category: Literal["actuator"] = "actuator"
    technology: Literal["servo", "dc_motor", "stepper", "linear", "solenoid", "vibration", "other"]
    joint: Joint
    wiring: ElectricalSpec = Field(default_factory=ElectricalSpec)
    control: BehaviorSpec | None = None
    spec: ActuatorDescription | None = None

    @classmethod
    def position_servo(cls, *, id: str, name: str, travel: Range, max_speed: Quantity,
                       initial_position: Quantity, **kwargs):
        travel.min.require("angle")
        return cls(id=id, name=name, technology="servo", joint=Joint(kind="revolute",
            parent_body=ObjectRef(collection="bodies", object_id="case"),
            child_body=ObjectRef(collection="bodies", object_id="shaft"), axis=(0.0, 0.0, 1.0),
            drive_mode="position", position_limit=travel, velocity_limit=max_speed,
            initial_position=initial_position), **kwargs)

    @classmethod
    def continuous_motor(cls, *, id: str, name: str, max_speed: Quantity,
                         technology="dc_motor", **kwargs):
        return cls(id=id, name=name, technology=technology, joint=Joint(kind="continuous",
            parent_body=ObjectRef(collection="bodies", object_id="case"),
            child_body=ObjectRef(collection="bodies", object_id="shaft"), axis=(0.0, 0.0, 1.0),
            drive_mode="velocity", velocity_limit=max_speed,
            initial_position=Quantity(value=0.0, unit="rad")), **kwargs)

    @model_validator(mode="after")
    def active_joint(self):
        if self.spec:
            if self.spec.steps_per_revolution is not None and self.technology != "stepper":
                raise ValueError("steps_per_revolution applies only to stepper actuators")
            if any(name not in self.wiring.terminals for name in self.spec.limit_terminals):
                raise ValueError("Limit terminals must exist in actuator wiring")
            if len(set(self.spec.limit_terminals)) != len(self.spec.limit_terminals):
                raise ValueError("Limit terminal references must be unique")
            require_positive(self.spec.rated_effort, "force" if self.joint.dimension == "length" else "torque")
        if self.joint.kind == "fixed" or self.joint.drive_mode == "passive":
            raise ValueError("Actuators require a position or velocity driven moving joint")
        if self.joint.initial_position is None:
            raise ValueError("Actuators require an explicit initial position")
        if self.joint.drive_mode == "position" and self.joint.velocity_limit is None:
            raise ValueError("Position actuators require a velocity limit")
        if self.control:
            dimension = self.joint.dimension if self.joint.drive_mode == "position" else (
                "speed" if self.joint.dimension == "length" else "angular_speed")
            if self.control.output_type.kind != "scalar":
                raise ValueError("Actuator control must produce a scalar")
            Quantity(value=0.0, unit=self.control.output_type.unit).require(dimension)
        return self


class TransmissionComponent(ComponentDesign):
    category: Literal["transmission"] = "transmission"
    mechanism: Literal["shaft", "gear", "belt", "screw", "linkage", "bearing"]
    motion: MotionSpec
    spec: MechanicalDescription | None = None

    def joint_ref(self, name: str, *, instance_path=()):
        if name not in self.motion.joints:
            raise ValueError(f"Unknown transmission joint: {name}")
        return ObjectRef(instance_path=instance_path, collection="joints", object_id=name)


class Transport(ComponentDesign):
    category: Literal["transport"] = "transport"
    mechanism: Literal["passive", "fan", "pump", "auger", "valve"]
    material: MaterialSpec

    @model_validator(mode="after")
    def paths_match(self):
        if not self.material.paths or any(p.mechanism != self.mechanism for p in self.material.paths.values()):
            raise ValueError("Transport needs paths matching its mechanism")
        return self

    def port_ref(self, name: str, *, instance_path=()):
        if name not in self.material.ports:
            raise ValueError(f"Unknown material port: {name}")
        return ObjectRef(instance_path=instance_path, collection="material_ports", object_id=name)


class EnergyStorage(ComponentDesign):
    category: Literal["energy_storage"] = "energy_storage"
    mechanism: Literal["torsion_spring", "linear_spring", "flywheel"]
    capacity_j: Positive
    initial_energy_j: float = Field(default=0.0, ge=0)
    motion: MotionSpec = Field(default_factory=MotionSpec)

    @model_validator(mode="after")
    def capacity(self):
        if self.initial_energy_j > self.capacity_j:
            raise ValueError("Initial energy exceeds capacity")
        if any(j.drive_mode != "passive" for j in self.motion.joints.values()):
            raise ValueError("Storage motion must be passive; no energy-to-motion solver is implemented")
        return self

    def store_energy(self, joules: float):
        """Revise initial design conditions; this does not simulate spring release."""
        return self.replace(initial_energy_j=joules)
