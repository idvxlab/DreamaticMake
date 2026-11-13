"""Versioned CAD housing metadata; geometry remains in GeometrySpec."""
from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Contract
from element.base.quantity import Parameter
from element.base.reference import AssetRef
from element.interfaces.appearance import ColorHex


class HousingMaterial(Contract):
    name: str = Field(min_length=1, max_length=200)
    color: ColorHex | None = Field(default=None, exclude_if=lambda value: value is None)
    density: Parameter | None = None
    elastic_modulus: Parameter | None = None
    yield_strength: Parameter | None = None
    poisson_ratio: Parameter | None = None
    notes: str = Field(default='', max_length=10000)

    @model_validator(mode='after')
    def dimensions(self):
        for name, dimension in (('density', 'density'), ('elastic_modulus', 'pressure'),
                                ('yield_strength', 'pressure'), ('poisson_ratio', 'dimensionless')):
            parameter = getattr(self, name)
            if parameter is None:
                continue
            values = ([parameter.value] if parameter.value else []) + (
                [parameter.range.min, parameter.range.max] if parameter.range else [])
            for value in values:
                number = value.require(dimension)
                if name == 'poisson_ratio':
                    if not -1 < number < 0.5:
                        raise ValueError('Isotropic Poisson ratio must be between -1 and 0.5')
                elif number <= 0:
                    raise ValueError(f'{name} must be positive')
        return self


class CADHousingSpec(Contract):
    schema_version: Literal['0.1.0-draft'] = '0.1.0-draft'
    material: HousingMaterial
    source_asset: AssetRef | None = None
    cad_assets: tuple[AssetRef, ...] = Field(default=(), max_length=128)
    manufacturing_process: str | None = None
