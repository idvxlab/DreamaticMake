"""hardware_selection workflow contract and context requirements."""
from typing import Literal
from process.artifacts import HardwareSelectionOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

HardwareSelectionInput = WorkflowInput[HardwareSelectionOutput]


class HardwareSelectionRequest(WorkflowRequest[HardwareSelectionOutput]):
    process_kind: Literal['hardware_selection'] = 'hardware_selection'


class HardwareSelectionProcess(WorkflowProcess):
    kind = 'hardware_selection'
    spec = ('硬件选型', HardwareSelectionOutput, ('requirements',), (),
        ('requirements', 'element_library', 'constraints'))
    title = spec[0]
    request_model = HardwareSelectionRequest


__all__ = ['HardwareSelectionInput', 'HardwareSelectionOutput', 'HardwareSelectionRequest', 'HardwareSelectionProcess']
