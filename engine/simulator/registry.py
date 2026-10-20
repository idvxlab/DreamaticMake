"""Closed built-in registry. Descriptions cannot import Python code."""

from engine.base.quantity import UNITS

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


def evaluate(spec, inputs, state, now):
    """Pure evaluation: (value, next_state, next_wakeup). Scalar values are SI."""
    model = spec.model_id
    values = {k: sample.value if sample.quality == "valid" else None for k, sample in inputs.items()}
    value = values.get("value")
    if model in ("constant", "pass"):
        return value, state, None
    if model == "not":
        return {"0": "1", "1": "0"}.get(value, "X"), state, None
    if model in ("and", "or"):
        a, b = values["a"], values["b"]
        decisive, neutral = ("0", "1") if model == "and" else ("1", "0")
        result = decisive if decisive in (a, b) else neutral if a == b == neutral else "X"
        return result, state, None
    if model == "threshold":
        return ("X" if not isinstance(value, (int, float)) or isinstance(value, bool)
                else "1" if value >= spec.parameters["threshold"].si_value else "0"), state, None
    if model == "pulse_position_command":
        pulse = values["pulse"]
        p = {k: v.si_value for k, v in spec.parameters.items()}
        if not isinstance(pulse, (int, float)) or isinstance(pulse, bool) or not p["pulse_min"] <= pulse <= p["pulse_max"]:
            return None, state, None
        fraction = (pulse - p["pulse_min"]) / (p["pulse_max"] - p["pulse_min"])
        return p["angle_min"] + fraction * (p["angle_max"] - p["angle_min"]), state, None
    if model == "timer":
        if value != "1":
            return "0" if value == "0" else "X", {}, None
        start = state.get("start", now)
        due = start + spec.parameters["delay"].si_value
        return "1" if now >= due - 1e-12 else "0", {"start": start}, due if due > now + 1e-12 else None
    if model == "state_machine":
        current = state.get("state", spec.initial_state)
        event = values["event"]
        if event is not None and event != state.get("last_event"):
            for transition in spec.transitions:
                if transition.from_state == current and transition.event == event:
                    current = transition.to_state
                    break
        return spec.states[current], {"state": current, "last_event": event}, None
    raise ValueError(f"Unsupported behavior: {model}")
