"""requirements workflow contract and context requirements."""
from typing import Literal
from process.artifacts import RequirementsOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

RequirementsInput = WorkflowInput[RequirementsOutput]


class RequirementsRequest(WorkflowRequest[RequirementsOutput]):
    process_kind: Literal['requirements'] = 'requirements'


class RequirementsProcess(WorkflowProcess):
    kind = 'requirements'
    spec = ('需求与功能文档', RequirementsOutput, (), (),
        ('source_documents', 'constraints'))
    title = spec[0]
    request_model = RequirementsRequest


__all__ = ['RequirementsInput', 'RequirementsOutput', 'RequirementsRequest', 'RequirementsProcess']
