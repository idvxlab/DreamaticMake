from math import isfinite
from element.base.quantity import Quantity, UNITS

def typed_value(value, signal_type):
    if value is None:
        return None
    kind = signal_type.kind
    if kind == "scalar":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
            raise ValueError("Scalar fixtures require finite numbers")
        return Quantity(value=value, unit=signal_type.unit).si_value
    if kind == "digital" and value in ("0", "1", "X", "Z"):
        return value
    if kind == "boolean" and isinstance(value, bool):
        return value
    if kind == "event" and isinstance(value, str):
        return value
    raise ValueError(f"Invalid or unsupported fixture value for {kind}")

def compatible(a, b):
    return a.kind == b.kind and (a.kind != "scalar" or UNITS[a.unit][0] == UNITS[b.unit][0])
