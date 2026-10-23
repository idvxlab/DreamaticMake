from typing import Literal
from element.base.contract import Contract, Id
from element.base.reference import AssetRef


class SourceRecord(Contract):
    title: str
    url: str | None = None
    asset_ref: AssetRef | None = None
    publisher: str | None = None
    source_revision: str | None = None
    retrieved_at: str | None = None
    locator: str | None = None


class Evidence(Contract):
    kind: Literal["manufacturer_rated", "assumed", "calculated", "measured", "tutorial_reported"]
    source_ref: Id | None = None
    locator: str | None = None
    conditions: str
    note: str
