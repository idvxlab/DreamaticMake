"""Explicit scenario commands for reusable actuator definitions."""
from element.base.reference import ObjectRef
from engine.schema.scenario import JointCommand

def _command(actuator, mode, value, time_s, instance_path):
    if actuator.joint.drive_mode != mode:
        raise ValueError(f"This actuator supports {actuator.joint.drive_mode}, not {mode}")
    if actuator.control is not None:
        raise ValueError("Actuator is behavior-driven; bind its control input instead")
    dimension = actuator.joint.dimension if mode == "position" else (
        "speed" if actuator.joint.dimension == "length" else "angular_speed")
    value.require(dimension)
    if mode == "position" and actuator.joint.position_limit and not actuator.joint.position_limit.contains(value):
        raise ValueError("Position command exceeds declared limits")
    if mode == "velocity" and actuator.joint.velocity_limit and abs(value.si_value) > actuator.joint.velocity_limit.si_value:
        raise ValueError("Speed command exceeds declared limits")
    return JointCommand(time_s=time_s, target=ObjectRef(instance_path=instance_path,
        collection="joints", object_id="axis"), mode=mode, value=value)

def move_to(actuator, position, *, time_s=0.0, instance_path=()):
    return _command(actuator, "position", position, time_s, instance_path)

def set_speed(actuator, speed, *, time_s=0.0, instance_path=()):
    return _command(actuator, "velocity", speed, time_s, instance_path)
