"""Design processes consume engine/element objects; they never own those definitions."""
from process.context import ProcessContext
from process.contracts import ProcessScope, BaseSnapshot, DesignProposal, InputRequirementReport
from process.proposal import build_candidate
from process.selection import SelectionProcess, SelectionInput, SelectionOutput, SelectionRequest, SelectionResult
from process.placement import PlacementProcess, PlacementInput, PlacementOutput, PlacementRequest, PlacementResult, PlacementTarget
from process.connection import ConnectionProcess, ConnectionInput, ConnectionOutput, ConnectionRequest, ConnectionResult
from process.motion import MotionProcess, MotionInput, MotionOutput, MotionRequest, MotionResult, JointInitial
from process.mechanical_detail import (MechanicalDetailProcess, MechanicalDetailInput,
    MechanicalDetailOutput, MechanicalDetailRequest, MechanicalDetailResult)
from process.circuit_detail import CircuitDetailProcess, CircuitDetailInput, CircuitDetailOutput, CircuitDetailRequest, CircuitDetailResult
from process.logic_detail import LogicDetailProcess, LogicDetailInput, LogicDetailOutput, LogicDetailRequest, LogicDetailResult

__all__ = [name for name in globals() if not name.startswith('_') and name not in (
    'context', 'contracts', 'proposal', 'base', 'selection', 'placement', 'connection',
    'motion', 'mechanical_detail', 'circuit_detail', 'logic_detail')]
