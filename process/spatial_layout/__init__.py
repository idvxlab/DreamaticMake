"""spatial_layout workflow contract and context requirements."""
from typing import Literal
from process.artifacts import SpatialLayoutOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

SpatialLayoutInput = WorkflowInput[SpatialLayoutOutput]


class SpatialLayoutRequest(WorkflowRequest[SpatialLayoutOutput]):
    process_kind: Literal['spatial_layout'] = 'spatial_layout'


class SpatialLayoutProcess(WorkflowProcess):
    kind = 'spatial_layout'
    spec = ('空间布局', SpatialLayoutOutput,
        ('requirements', 'hardware_selection', 'appearance'), (),
        ('hardware_geometry', 'appearance_images', 'world_m_xyzw', 'constraints'))
    title = spec[0]
    request_model = SpatialLayoutRequest


__all__ = ['SpatialLayoutInput', 'SpatialLayoutOutput', 'SpatialLayoutRequest', 'SpatialLayoutProcess']
