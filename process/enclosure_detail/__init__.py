"""enclosure_detail workflow contract and context requirements."""
from typing import Literal
from process.artifacts import EnclosureDetailOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

EnclosureDetailInput = WorkflowInput[EnclosureDetailOutput]


class EnclosureDetailRequest(WorkflowRequest[EnclosureDetailOutput]):
    process_kind: Literal['enclosure_detail'] = 'enclosure_detail'


class EnclosureDetailProcess(WorkflowProcess):
    kind = 'enclosure_detail'
    spec = ('外壳组件深化设计', EnclosureDetailOutput,
        ('requirements', 'spatial_layout', 'appearance'), (),
        ('hardware_geometry', 'world_poses', 'appearance_images', 'materials', 'constraints'))
    title = spec[0]
    request_model = EnclosureDetailRequest


__all__ = ['EnclosureDetailInput', 'EnclosureDetailOutput', 'EnclosureDetailRequest', 'EnclosureDetailProcess']
