"""motion_detail workflow contract and context requirements."""
from typing import Literal
from process.artifacts import MotionDetailOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

MotionDetailInput = WorkflowInput[MotionDetailOutput]


class MotionDetailRequest(WorkflowRequest[MotionDetailOutput]):
    process_kind: Literal['motion_detail'] = 'motion_detail'


class MotionDetailProcess(WorkflowProcess):
    kind = 'motion_detail'
    spec = ('运动深化设计', MotionDetailOutput,
        ('requirements', 'spatial_layout'), (),
        ('hardware_bodies', 'world_poses', 'joint_ranges', 'initial_configuration', 'constraints'))
    title = spec[0]
    request_model = MotionDetailRequest


__all__ = ['MotionDetailInput', 'MotionDetailOutput', 'MotionDetailRequest', 'MotionDetailProcess']
