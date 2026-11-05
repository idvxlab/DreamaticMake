"""Read-only, LLM-facing discovery contracts, separate from native element admission."""
from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Contract, Id, Sha256
from element.base.quantity import Quantity
from element.schema.library import Category, ElementRef


class ParameterRequirement(Contract):
    parameter_code: Id
    minimum: Quantity | None = None
    maximum: Quantity | None = None
    weight: float = Field(default=1.0, gt=0, le=100)
    hard: bool = True

    @model_validator(mode='after')
    def bounds(self):
        if self.minimum is None and self.maximum is None:
            raise ValueError('Specify at least one numeric bound')
        if self.minimum and self.maximum and (self.minimum.dimension != self.maximum.dimension or
                self.minimum.si_value > self.maximum.si_value):
            raise ValueError('Requirement bounds must be compatible and ordered')
        return self


class RetrievalQuery(Contract):
    text: str = Field(default='', max_length=2000)
    categories: tuple[Category, ...] = ()
    requirements: tuple[ParameterRequirement, ...] = Field(default=(), max_length=32)
    include_incomplete: bool = True
    include_mismatches: bool = False
    limit: int = Field(default=10, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=10000)
    expected_generation: Sha256 | None = None


class RetrievalRef(Contract):
    record_kind: Literal['element_search_ref'] = 'element_search_ref'
    library_id: Id
    element_id: Id
    revision: int = Field(ge=1)
    content_hash: Sha256


class ParameterFact(Contract):
    code: Id
    status: Literal['known', 'assumed', 'unknown']
    value: Quantity | None = None
    minimum: Quantity | None = None
    maximum: Quantity | None = None
    conditions: str = ''
    evidence: dict[str, dict] = Field(default_factory=dict)
    sources: dict[str, dict] = Field(default_factory=dict)
    evidence_supported: bool = False


class ParameterAssessment(Contract):
    requirement: ParameterRequirement
    outcome: Literal['match', 'mismatch', 'unknown']
    parameter_codes: tuple[str, ...] = ()
    facts: tuple[ParameterFact, ...] = ()
    explanation: str


class RetrievalCandidate(Contract):
    ref: RetrievalRef
    native_ref: ElementRef | None = None
    name: str
    category: Category
    selectable: bool
    blockers: tuple[str, ...] = ()
    score: float
    matched_terms: tuple[str, ...] = ()
    assessments: tuple[ParameterAssessment, ...] = ()
    missing_parameters: tuple[str, ...] = ()
    selection_state: Literal['eligible', 'needs_review', 'rejected']


class RetrievalPlan(Contract):
    text: str = ''
    categories: tuple[Category, ...] = ()
    category_source: Literal['explicit', 'inferred', 'none']
    terms: tuple[str, ...] = ()
    requirements: tuple[ParameterRequirement, ...] = ()
    warnings: tuple[str, ...] = ()


class RetrievalResult(Contract):
    schema_version: Literal['0.1.0-draft'] = '0.1.0-draft'
    plan: RetrievalPlan
    items: tuple[RetrievalCandidate, ...]
    total: int
    next_offset: int | None = None
    index_generation: Sha256
    limitations: tuple[str, ...] = (
        'Deterministic bilingual vocabulary and bounded numeric parsing; no model provider is called.',
        'Scores rank candidates, not physical compatibility or engineering approval.',
        'Unknown, assumed or unsupported parameters never count as verified matches.',
    )
