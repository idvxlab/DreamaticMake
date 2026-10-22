from dataclasses import dataclass, field


@dataclass
class SimulationState:
    time_s: float = 0.0
    joint_positions: dict = field(default_factory=dict)
    joint_velocities: dict = field(default_factory=dict)
    body_poses: dict = field(default_factory=dict)
    network_samples: dict = field(default_factory=dict)
    behavior_outputs: dict = field(default_factory=dict)
    behavior_states: dict = field(default_factory=dict)
    sensor_samples: dict = field(default_factory=dict)
    effects: dict = field(default_factory=dict)
