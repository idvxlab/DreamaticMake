"""Optional common procurement metadata. Unknown values remain null."""
from pydantic import Field
from element.base.contract import Contract


class Procurement(Contract):
    metadata_version: str = Field(default='1', pattern=r'^1$')
    manufacturer: str | None = None
    model: str | None = None
    supplier: str | None = None
    sku: str | None = None
    purchase_url: str | None = Field(default=None, pattern=r'^https?://[^\s]+$')
    price: float | None = Field(default=None, ge=0)
    currency: str = Field(default='CNY', pattern=r'^[A-Z]{3}$')
    price_observed_at: str | None = None
    availability: str | None = None
    description: str = ''
    tags: tuple[str, ...] = ()
