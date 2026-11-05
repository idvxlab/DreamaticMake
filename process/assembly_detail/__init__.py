"""assembly_detail workflow contract and context requirements."""
from typing import Literal
from process.artifacts import AssemblyDetailOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

AssemblyDetailInput = WorkflowInput[AssemblyDetailOutput]


class AssemblyDetailRequest(WorkflowRequest[AssemblyDetailOutput]):
    process_kind: Literal['assembly_detail'] = 'assembly_detail'


class AssemblyDetailProcess(WorkflowProcess):
    kind = 'assembly_detail'
    spec = ('装配与连接深化设计', AssemblyDetailOutput,
        ('requirements', 'spatial_layout', 'enclosure_detail'), ('motion_detail',),
        ('enclosure_components', 'hardware_mounts', 'world_poses', 'motion', 'constraints'))
    title = spec[0]
    request_model = AssemblyDetailRequest


__all__ = ['AssemblyDetailInput', 'AssemblyDetailOutput', 'AssemblyDetailRequest', 'AssemblyDetailProcess']
