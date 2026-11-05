"""logical_layout workflow contract and context requirements."""
from typing import Literal
from process.artifacts import LogicalLayoutOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

LogicalLayoutInput = WorkflowInput[LogicalLayoutOutput]


class LogicalLayoutRequest(WorkflowRequest[LogicalLayoutOutput]):
    process_kind: Literal['logical_layout'] = 'logical_layout'


class LogicalLayoutProcess(WorkflowProcess):
    kind = 'logical_layout'
    spec = ('电路逻辑布局', LogicalLayoutOutput,
        ('requirements', 'hardware_selection'), (),
        ('hardware_terminals', 'requirements', 'constraints'))
    title = spec[0]
    request_model = LogicalLayoutRequest


__all__ = ['LogicalLayoutInput', 'LogicalLayoutOutput', 'LogicalLayoutRequest', 'LogicalLayoutProcess']
