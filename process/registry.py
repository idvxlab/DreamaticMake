"""Explicit registry, never module names supplied by a request."""
from process import (SelectionProcess, PlacementProcess, ConnectionProcess, MotionProcess,
    MechanicalDetailProcess, CircuitDetailProcess, LogicDetailProcess)

PROCESSES = {cls.kind: cls for cls in (SelectionProcess, PlacementProcess, ConnectionProcess,
    MotionProcess, MechanicalDetailProcess, CircuitDetailProcess, LogicDetailProcess)}


def get_process(kind):
    if not isinstance(kind, str) or kind not in PROCESSES:
        raise ValueError('Unknown process kind')
    return PROCESSES[kind]()
