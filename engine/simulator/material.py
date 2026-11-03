"""An explicit inventory primitive; topology alone never invokes it."""

from math import isfinite


def transfer_mass(source_kg: float, target_kg: float, capacity_kg: float, rate_kg_s: float, dt_s: float):
    values = (source_kg, target_kg, capacity_kg, rate_kg_s, dt_s)
    if any(not isfinite(v) or v < 0 for v in values) or target_kg > capacity_kg:
        raise ValueError("Invalid inventory, capacity, flow rate, or step")
    moved = min(source_kg, capacity_kg - target_kg, rate_kg_s * dt_s)
    return source_kg - moved, target_kg + moved
