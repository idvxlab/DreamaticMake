from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Contract, Id, ChannelId, NonNegative, Sha256
from element.base.frame import Pose
from element.base.quantity import Quantity
from element.base.reference import ObjectRef
from element.base.signal import SignalType, SignalValue


class FixtureChannel(Contract):
    signal_type: SignalType
    initial_value: SignalValue = None


class Stimulus(Contract):
    time_s: NonNegative
    channel: ChannelId
    value: SignalValue


class RootPlacement(Contract):
    body_ref: ObjectRef
    world_pose: Pose = Pose()
    anchored: bool = True


class JointCommand(Contract):
    time_s: NonNegative
    target: ObjectRef
    mode: Literal["position", "velocity"]
    value: Quantity


class SolverOptions(Contract):
    step_s: float = Field(default=0.01, ge=1e-9)
    max_steps: int = Field(default=10000, ge=1, le=1000000)
    logic_iterations: int = Field(default=32, ge=1, le=256)
    collision: bool = True
    conservative_shapes: bool = False


class Scenario(Contract):
    dsl_version: Literal["0.2.0-proposal"] = "0.2.0-proposal"
    record_kind: Literal["scenario"] = "scenario"
    id: Id
    snapshot_id: Sha256
    duration_s: NonNegative
    roots: tuple[RootPlacement, ...] = ()
    channels: dict[ChannelId, FixtureChannel] = Field(default_factory=dict)
    stimuli: tuple[Stimulus, ...] = ()
    joint_commands: tuple[JointCommand, ...] = ()
    solver_options: SolverOptions = Field(default_factory=SolverOptions)
    random_seed: int = 0

    @model_validator(mode="after")
    def timeline(self):
        seen = set()
        for event in self.stimuli:
            if event.channel not in self.channels or event.time_s > self.duration_s:
                raise ValueError("Stimulus references an absent channel or exceeds duration")
            key = (event.time_s, event.channel)
            if key in seen:
                raise ValueError("Conflicting simultaneous channel updates")
            seen.add(key)
        commands = set()
        for event in self.joint_commands:
            if event.target.collection != "joints" or event.time_s > self.duration_s:
                raise ValueError("Invalid joint command target/time")
            key = (event.time_s, event.target.key())
            if key in commands:
                raise ValueError("Conflicting simultaneous joint commands")
            commands.add(key)
        return self
