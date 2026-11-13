"""Final project documentation based on pinned engineering deliverables."""
from typing import Literal
from process.artifacts import ProcurementAssemblyGuideOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

ProcurementAssemblyGuideInput = WorkflowInput[ProcurementAssemblyGuideOutput]


class ProcurementAssemblyGuideRequest(WorkflowRequest[ProcurementAssemblyGuideOutput]):
    process_kind: Literal['procurement_assembly_guide'] = 'procurement_assembly_guide'


class ProcurementAssemblyGuideProcess(WorkflowProcess):
    kind = 'procurement_assembly_guide'
    spec = ('采购与装配说明', ProcurementAssemblyGuideOutput,
        ('hardware_selection', 'logical_layout', 'assembly_detail', 'print_optimization'),
        ('requirements', 'software_design'),
        ('part_quantities', 'assembly_sequence', 'cad_revisions', 'verification_evidence'))
    title = spec[0]
    request_model = ProcurementAssemblyGuideRequest
