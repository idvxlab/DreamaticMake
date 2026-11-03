"""Closed built-in registry. Descriptions cannot import Python code."""

from element.base.quantity import UNITS
from element.base.signal import SignalType

MODELS = {
    "constant": ({"value"}, set()),
    "pass": ({"value"}, set()),
    "not": ({"value"}, set()),
    "and": ({"a", "b"}, set()),
    "or": ({"a", "b"}, set()),
    "threshold": ({"value"}, {"threshold"}),
    "pulse_position_command": ({"pulse"}, {"pulse_min", "pulse_max", "angle_min", "angle_max"}),
    "timer": ({"value"}, {"delay"}),
    "state_machine": ({"event"}, set()),
}


def input_signal_type(spec):
    """Expected type of each input for the current closed, homogeneous-input models."""
    if spec.model_id in ("pass", "constant"):
        return spec.output_type
    if spec.model_id in ("not", "and", "or", "timer"):
        return SignalType(kind="digital")
    if spec.model_id == "pulse_position_command":
        return SignalType(kind="scalar", unit="s")
    if spec.model_id == "threshold":
        return SignalType(kind="scalar", unit=spec.parameters["threshold"].unit)
    if spec.model_id == "state_machine":
        return SignalType(kind="event")
    raise ValueError(f"Unregistered behavior model: {spec.model_id}")


def check_behavior(spec):
    errors = []
    if spec.model_id not in MODELS:
        return [f"Unregistered behavior model: {spec.model_id}"]
    if spec.output_type.kind in ("image", "data"):
        return ["Image/data outputs are descriptive contracts, not executable sample encodings"]
    inputs, parameters = MODELS[spec.model_id]
    if set(spec.inputs) != inputs or set(spec.parameters) != parameters:
        errors.append("Behavior input/parameter names do not match its registered contract")
        return errors
    if (spec.model_id == "state_machine") != (spec.kind == "state_machine"):
        errors.append("Behavior kind does not match model_id")
    if spec.model_id in ("not", "and", "or", "threshold", "timer") and spec.output_type.kind != "digital":
        errors.append("Logic model requires digital output")
    try:
        if spec.model_id == "timer" and spec.parameters["delay"].require("time") < 0:
            errors.append("Delay cannot be negative")
        if spec.model_id == "pulse_position_command":
            p = spec.parameters
            if p["pulse_min"].require("time") <= 0 or p["pulse_max"].require("time") <= p["pulse_min"].si_value:
                errors.append("Pulse endpoints must be positive and ordered")
            if p["angle_min"].require("angle") >= p["angle_max"].require("angle"):
                errors.append("Angle endpoints must be ordered")
            if spec.output_type.kind != "scalar" or UNITS[spec.output_type.unit][0] != "angle":
                errors.append("Pulse position model requires an angle output")
    except ValueError as exc:
        errors.append(str(exc))
    return errors
