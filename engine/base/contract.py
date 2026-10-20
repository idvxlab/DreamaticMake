"""Validation policy shared by all external contracts."""

from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, model_validator

Id = Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]*$", max_length=128)]
ChannelId = Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]*(/[A-Za-z_][A-Za-z0-9_.-]*)*$", max_length=4096)]
Positive = Annotated[float, Field(gt=0)]
NonNegative = Annotated[float, Field(ge=0)]
Revision = Annotated[int, Field(ge=1)]
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class FrozenDict(dict):
    """JSON-compatible immutable maps, including nested contract dictionaries."""
    def _readonly(self, *args, **kwargs):
        raise TypeError("Contract mappings are immutable")

    __setitem__ = __delitem__ = clear = pop = popitem = setdefault = update = __ior__ = _readonly

    def __deepcopy__(self, memo):
        from copy import deepcopy
        return FrozenDict({deepcopy(k, memo): deepcopy(v, memo) for k, v in self.items()})


class Contract(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, frozen=True, allow_inf_nan=False,
        validate_default=True, revalidate_instances="always",
    )

    @model_validator(mode="after")
    def freeze_maps(self):
        for name in type(self).model_fields:
            value = getattr(self, name)
            if isinstance(value, dict) and not isinstance(value, FrozenDict):
                object.__setattr__(self, name, FrozenDict(value))
        return self
