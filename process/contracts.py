"""Versioned process envelopes over the existing engine and element contracts."""
from typing import Generic, Literal, TypeVar
from pydantic import Field, JsonValue
from element.base.contract import Contract, Id, Sha256
from element.base.reference import AssetRef
from element.schema.library import ElementDefinition
from engine.design.contracts import DesignPackage, Record, RecordRef, ObjectRef, Diagnostic
from engine.design.io import parse_package, snapshot_id

ProcessKind = Literal['selection', 'placement', 'connection', 'motion',
                      'mechanical_detail', 'circuit_detail', 'logic_detail',
                      'requirements', 'appearance', 'hardware_selection', 'spatial_layout',
                      'logical_layout', 'enclosure_detail', 'motion_detail', 'assembly_detail',
                      'print_optimization', 'software_design']
I = TypeVar('I', bound=Contract)
O = TypeVar('O', bound=Contract)


class BaseSnapshot(Contract):
    design: DesignPackage
    snapshot_id: Sha256
    expected_manifest_revision: int = Field(ge=1)


class ProcessScope(Contract):
    read_refs: tuple[ObjectRef, ...] = ()
    write_record_ids: tuple[Id, ...] = Field(default=(), max_length=2000)
    allowed_asset_refs: tuple[AssetRef, ...] = Field(default=(), max_length=1000)


class ProcessRequest(Contract, Generic[I]):
    record_kind: Literal['design_process_request'] = 'design_process_request'
    schema_version: Literal['0.1.0-draft'] = '0.1.0-draft'
    request_id: Id
    process_kind: ProcessKind
    base: BaseSnapshot
    scope: ProcessScope = ProcessScope()
    intent: str = Field(default='', max_length=10000)
    requirement_refs: tuple[ObjectRef, ...] = ()
    requested_checks: tuple[str, ...] = Field(default=('references',), max_length=16)
    input: I

    @classmethod
    def for_design(cls, design, *, input, request_id='request', write_record_ids=(), **kwargs):
        design = parse_package(design)
        return cls(request_id=request_id, base=BaseSnapshot(design=design,
            snapshot_id=snapshot_id(design.manifest), expected_manifest_revision=design.manifest.revision),
            scope=ProcessScope(write_record_ids=tuple(write_record_ids)), input=input, **kwargs)


class InputNeed(Contract):
    key: str
    description: str
    source: Literal['caller', 'design', 'element', 'asset', 'executor']
    state: Literal['available', 'missing', 'assumed', 'conflict', 'unsupported']
    expected_schema: str = ''
    subject_refs: tuple[ObjectRef, ...] = ()
    blocking: bool = True


class InputRequirementReport(Contract):
    items: tuple[InputNeed, ...] = ()

    @property
    def ready(self):
        return not any(i.blocking and i.state not in ('available', 'assumed') for i in self.items)


class RecordUpsert(Contract):
    op: Literal['upsert_record'] = 'upsert_record'
    before: RecordRef | None = None
    record: Record


class RecordDelete(Contract):
    op: Literal['delete_record'] = 'delete_record'
    before: RecordRef


class DesignProposal(Contract):
    proposal_id: Id
    base_snapshot_id: Sha256
    record_changes: tuple[RecordUpsert | RecordDelete, ...] = Field(default=(), max_length=2000)
    element_drafts: tuple[ElementDefinition, ...] = Field(default=(), max_length=1000)
    asset_refs: tuple[AssetRef, ...] = ()
    affected_refs: tuple[ObjectRef, ...] = ()
    invalidates_previous_checks: Literal[True] = True


class CheckEvidence(Contract):
    run_id: str
    subject_snapshot_id: Sha256
    check_kind: str
    execution: Literal['completed', 'unsupported']
    outcome: Literal['pass', 'fail', 'unknown']
    executor_version: str
    options_hash: Sha256
    native_report: dict[str, JsonValue]


class ProcessResult(Contract, Generic[O]):
    record_kind: Literal['design_process_result'] = 'design_process_result'
    schema_version: Literal['0.1.0-draft'] = '0.1.0-draft'
    request_id: Id
    process_kind: ProcessKind
    base_snapshot_id: Sha256
    status: Literal['completed', 'needs_input', 'unsupported', 'failed']
    output: O | None = None
    proposals: tuple[DesignProposal, ...] = ()
    checks: tuple[CheckEvidence, ...] = ()
    missing_inputs: tuple[InputNeed, ...] = ()
    diagnostics: tuple[Diagnostic, ...] = ()


class ProcessDescriptor(Contract):
    process_kind: ProcessKind
    title: str
    actions: tuple[str, ...]
    input_schema: dict[str, JsonValue]
    output_schema: dict[str, JsonValue]
    category: Literal['operation', 'workflow'] = 'operation'
    required_upstream: tuple[str, ...] = ()
    optional_upstream: tuple[str, ...] = ()
    context_keys: tuple[str, ...] = ()
    limitations: tuple[str, ...] = ()
