"""Software engineering for pinned controller instances and logical wiring."""
from typing import Literal
from process.artifacts import SoftwareDesign, SoftwareDesignOutput
from process._workflow import WorkflowInput, WorkflowRequest, WorkflowProcess

SoftwareDesignInput = WorkflowInput[SoftwareDesignOutput]


class SoftwareDesignRequest(WorkflowRequest[SoftwareDesignOutput]):
    process_kind: Literal['software_design'] = 'software_design'


class SoftwareDesignProcess(WorkflowProcess):
    kind = 'software_design'
    spec = ('软件工程设计', SoftwareDesignOutput,
        ('requirements', 'hardware_selection', 'logical_layout'), ('motion_detail',),
        ('controller_instances', 'hardware_terminals', 'logical_nets', 'requirements', 'constraints'))
    title = spec[0]
    request_model = SoftwareDesignRequest


__all__ = ['SoftwareDesign', 'SoftwareDesignInput', 'SoftwareDesignOutput',
    'SoftwareDesignRequest', 'SoftwareDesignProcess']
