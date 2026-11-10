"""Versioned tool lifecycle contracts. Host contexts never cross the JSON API."""
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal
from pydantic import Field
from element.base.contract import Contract, Sha256


class ToolRequest(Contract):
    request_id: str = Field(min_length=1, max_length=128)
    tool_id: Literal['occt_geometry', 'fcl_collision', 'native_kinematics', 'sismic_statechart']
    operation: str
    snapshot_id: Sha256
    source_kind: Literal['design_v3', 'layout_v2']
    scope: tuple[str, ...] = ()
    options: dict = Field(default_factory=dict)
    scenario_ref: str | None = None


class Sample(Contract):
    time_s: float = Field(ge=0)
    positions: dict[str, float] = Field(default_factory=dict)


class PoseOptions(Contract):
    positions: dict[str, float] = Field(default_factory=dict)


class TrajectoryOptions(PoseOptions):
    samples: tuple[Sample, ...] = Field(min_length=1, max_length=1000)
    interpolation: Literal['linear_positions'] = 'linear_positions'
    max_step_s: float = Field(default=.02, gt=0, le=1)
    continuous_policy: Literal['unwrapped'] | None = None


class CollisionOptions(PoseOptions):
    pairs: tuple[tuple[str, str], ...] = ()
    minimum_m: float = Field(default=0, ge=0)


class TrajectoryCollisionOptions(TrajectoryOptions):
    pairs: tuple[tuple[str, str], ...] = ()
    minimum_m: float = Field(default=0, ge=0)


class OCCTOptions(Contract):
    linear_deflection_m: float = Field(default=.0001, ge=.000001, le=.01)
    angular_deflection_rad: float = Field(default=.2, gt=0, le=1)


class SismicOptions(Contract):
    profile: Literal['sismic/restricted-v1'] = 'sismic/restricted-v1'


class PreparedJob(Contract):
    request: ToolRequest
    status: Literal['ready', 'needs_input', 'unsupported', 'invalid']
    tool_input: dict = Field(default_factory=dict)
    source_map: dict = Field(default_factory=dict)
    dependency_manifest: dict = Field(default_factory=dict)
    plan: tuple[dict, ...] = ()
    requirements: tuple[str, ...] = ()
    omissions: tuple[str, ...] = ()

    @property
    def ready(self): return self.status == 'ready'


class ToolRunResult(Contract):
    tool_contract_version: Literal['tools/1'] = 'tools/1'
    tool_id: str
    operation: str
    adapter_version: str = '1'
    evidence: dict
    coverage_items: tuple[dict, ...] = ()
    findings: tuple[dict, ...] = ()
    artifacts: tuple[dict, ...] = ()
    source_map: dict = Field(default_factory=dict)
    presentation: dict = Field(default_factory=dict)


@dataclass(frozen=True)
class ToolContext:
    source: object
    workspace: Path
    asset_resolver: Callable | None = None
    scenario_resolver: Callable | None = None
    timeout_s: float = 20
    cancelled: Callable = lambda: False

    @property
    def snapshot_id(self):
        from .source import snapshot_id
        return snapshot_id(self.source)
