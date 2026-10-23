from element.interfaces.behavior_validation import MODELS, input_signal_type, check_behavior

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
