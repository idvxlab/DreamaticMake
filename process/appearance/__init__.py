"""appearance workflow contract and context requirements."""
from typing import Literal
from process.artifacts import AppearanceOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

AppearanceInput = WorkflowInput[AppearanceOutput]


class AppearanceRequest(WorkflowRequest[AppearanceOutput]):
    process_kind: Literal['appearance'] = 'appearance'


class AppearanceProcess(WorkflowProcess):
    kind = 'appearance'
    spec = ('外观设计', AppearanceOutput, ('requirements',), (),
        ('requirements', 'constraints'))
    title = spec[0]
    request_model = AppearanceRequest


__all__ = ['AppearanceInput', 'AppearanceOutput', 'AppearanceRequest', 'AppearanceProcess']
