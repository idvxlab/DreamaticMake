"""Injected read-only library and bounded assets. No approval or storage writers."""
from dataclasses import dataclass
from typing import Callable, Protocol
from element.base.reference import AssetRef
from element.schema.library import ElementRef, ElementDefinition, ElementQuery
from element.io.records import element_ref
from engine.design import resolve_design


class ElementReader(Protocol):
    def get(self, ref: ElementRef) -> ElementDefinition: ...
    def search(self, query: ElementQuery) -> dict: ...


@dataclass(frozen=True)
class ProcessContext:
    elements: ElementReader | None = None
    asset_resolver: Callable[[AssetRef], bytes] | None = None
    cancelled: Callable[[], bool] = lambda: False

    def resolve(self, package):
        return resolve_design(package, library=self.elements)

    def element(self, package, ref):
        for definition in package.elements:
            if element_ref(definition) == ref:
                return definition
        if self.elements:
            definition = self.elements.get(ref)
            if element_ref(definition) != ref:
                raise ValueError('Element pin/hash mismatch')
            return definition
        raise ValueError('Pinned element is not embedded and no library reader was supplied')
