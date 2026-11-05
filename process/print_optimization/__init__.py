"""print_optimization workflow contract and context requirements."""
from typing import Literal
from process.artifacts import PrintOptimizationOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

PrintOptimizationInput = WorkflowInput[PrintOptimizationOutput]


class PrintOptimizationRequest(WorkflowRequest[PrintOptimizationOutput]):
    process_kind: Literal['print_optimization'] = 'print_optimization'


class PrintOptimizationProcess(WorkflowProcess):
    kind = 'print_optimization'
    spec = ('打印件优化设计', PrintOptimizationOutput,
        ('assembly_detail',), (),
        ('assembled_cad', 'printer', 'support_strategy', 'min_feature_m', 'resolution_m', 'constraints'))
    title = spec[0]
    request_model = PrintOptimizationRequest


__all__ = ['PrintOptimizationInput', 'PrintOptimizationOutput', 'PrintOptimizationRequest', 'PrintOptimizationProcess']
