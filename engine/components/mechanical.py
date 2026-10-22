from pathlib import Path
from typing import Literal
from pydantic import Field, model_validator
from engine.base.contract import Positive
from engine.base.quantity import Quantity, Range
from engine.base.reference import AssetRef, ObjectRef
from engine.interface.geometry import GeometrySpec, Shape, RigidBody, Envelope, TriangleMesh, VisualAsset
from engine.interface.motion import Joint, MotionSpec
from engine.interface.material import MaterialSpec
from engine.interface.behavior import BehaviorSpec
from engine.interface.electrical import ElectricalSpec
from engine.interface.effects import MotionEffect, BehaviorOutputRef
from engine.schema.scenario import JointCommand
from engine.components.base import ComponentDesign
from engine.components.specs import MechanicalDescription, ActuatorDescription, require_positive


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
        from engine.io.load import read_asset
        from engine.io.mesh import MAX_STL_BYTES, resolve_stl
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

    def _lower(self):
        return self._definition()


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

    def _command(self, mode, value, time_s, instance_path):
        if self.joint.drive_mode != mode:
            raise ValueError(f"This actuator supports {self.joint.drive_mode}, not {mode}")
        if self.control is not None:
            raise ValueError("Actuator is behavior-driven; bind its control input instead")
        dimension = self.joint.dimension if mode == "position" else (
            "speed" if self.joint.dimension == "length" else "angular_speed")
        value.require(dimension)
        if mode == "position" and self.joint.position_limit and not self.joint.position_limit.contains(value):
            raise ValueError("Position command exceeds declared limits")
        if mode == "velocity" and self.joint.velocity_limit and abs(value.si_value) > self.joint.velocity_limit.si_value:
            raise ValueError("Speed command exceeds declared limits")
        return JointCommand(time_s=time_s, target=ObjectRef(instance_path=instance_path,
            collection="joints", object_id="axis"), mode=mode, value=value)

    def move_to(self, position: Quantity, *, time_s=0.0, instance_path=()):
        return self._command("position", position, time_s, instance_path)

    def set_speed(self, speed: Quantity, *, time_s=0.0, instance_path=()):
        return self._command("velocity", speed, time_s, instance_path)

    def _lower(self):
        effects = {} if self.control is None else {"motion": MotionEffect(
            target_joint=ObjectRef(collection="joints", object_id="axis"), mode=self.joint.drive_mode,
            value_type=self.control.output_type, behavior_output_ref=BehaviorOutputRef(behavior_id="control"))}
        return self._definition(motion=MotionSpec(joints={"axis": self.joint}), electrical=self.wiring,
            behaviors={"control": self.control} if self.control else {}, effects=effects)


class TransmissionComponent(ComponentDesign):
    category: Literal["transmission"] = "transmission"
    mechanism: Literal["shaft", "gear", "belt", "screw", "linkage", "bearing"]
    motion: MotionSpec
    spec: MechanicalDescription | None = None

    def joint_ref(self, name: str, *, instance_path=()):
        if name not in self.motion.joints:
            raise ValueError(f"Unknown transmission joint: {name}")
        return ObjectRef(instance_path=instance_path, collection="joints", object_id=name)

    def _lower(self):
        return self._definition(motion=self.motion)


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

    def _lower(self):
        return self._definition(material=self.material)


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

    def _lower(self):
        return self._definition(motion=self.motion)
