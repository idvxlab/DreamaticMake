from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Sha256, Revision
from element.base.diagnostic import Diagnostic
from element.base.frame import Pose
from element.base.signal import Sample


class TraceFrame(Contract):
    time_s: float
    body_poses: dict[str, Pose]
    joint_positions: dict[str, float]
    joint_velocities: dict[str, float]
    network_samples: dict[str, Sample]
    behavior_outputs: dict[str, Sample]
    sensor_samples: dict[str, Sample]
    effects: dict[str, Sample]
    collisions: tuple[tuple[str, str], ...] = ()


class SimulationResult(Contract):
    record_kind: Literal["simulation_result"] = "simulation_result"
    engine_version: str
    snapshot_id: Sha256
    scenario_hash: Sha256
    input_revisions: dict[str, Revision]
    status: Literal["completed", "failed", "unsupported", "cancelled"]
    actual_end_s: float
    random_seed: int
    coverage: tuple[str, ...]
    diagnostics: tuple[Diagnostic, ...]
    frames: tuple[TraceFrame, ...]
