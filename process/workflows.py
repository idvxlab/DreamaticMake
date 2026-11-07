"""Compatibility exports and explicit registration of folder-owned workflows.

Each stage owns its request type and dependency/context specification. Shared
artifact validation and execution remain in process._workflow.
"""
from process._workflow import (ContextPack, WorkflowInput, WorkflowRequest,
    WorkflowProcess, WorkflowOutput, WorkflowResult, project_artifact)
from process.requirements import RequirementsInput, RequirementsRequest, RequirementsProcess
from process.appearance import AppearanceInput, AppearanceRequest, AppearanceProcess
from process.hardware_selection import HardwareSelectionInput, HardwareSelectionRequest, HardwareSelectionProcess
from process.spatial_layout import SpatialLayoutInput, SpatialLayoutRequest, SpatialLayoutProcess
from process.logical_layout import LogicalLayoutInput, LogicalLayoutRequest, LogicalLayoutProcess
from process.enclosure_detail import EnclosureDetailInput, EnclosureDetailRequest, EnclosureDetailProcess
from process.motion_detail import MotionDetailInput, MotionDetailRequest, MotionDetailProcess
from process.assembly_detail import AssemblyDetailInput, AssemblyDetailRequest, AssemblyDetailProcess
from process.print_optimization import PrintOptimizationInput, PrintOptimizationRequest, PrintOptimizationProcess
from process.software_design import SoftwareDesignInput, SoftwareDesignRequest, SoftwareDesignProcess

WORKFLOWS = {cls.kind: cls for cls in (
    RequirementsProcess,
    AppearanceProcess,
    HardwareSelectionProcess,
    SpatialLayoutProcess,
    LogicalLayoutProcess,
    EnclosureDetailProcess,
    MotionDetailProcess,
    AssemblyDetailProcess,
    PrintOptimizationProcess,
    SoftwareDesignProcess,
)}
SPECS = {kind: cls.spec for kind, cls in WORKFLOWS.items()}

__all__ = ['WORKFLOWS', 'ContextPack', 'WorkflowOutput', 'WorkflowResult', 'project_artifact'] + [
    ''.join(w.title() for w in kind.split('_')) + suffix
    for kind in SPECS for suffix in ('Input', 'Request', 'Process')]
