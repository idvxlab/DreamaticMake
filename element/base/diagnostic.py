from typing import Literal
from element.base.contract import Contract


class Diagnostic(Contract):
    code: str
    severity: Literal["info", "warning", "error"]
    outcome: Literal["pass", "fail", "unknown", "unsupported"]
    message: str
    object_refs: tuple[str, ...] = ()
    field_path: str | None = None
    evidence_refs: tuple[str, ...] = ()
    assumptions: tuple[str, ...] = ()


class ModelError(ValueError):
    def __init__(self, diagnostics: list[Diagnostic] | tuple[Diagnostic, ...]):
        self.diagnostics = tuple(diagnostics)
        super().__init__("; ".join(f"{d.code}: {d.message}" for d in diagnostics))
