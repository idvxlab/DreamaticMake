"""Author a custom CAD housing as a specialized structure, preserving 14 categories."""
from typing import Literal
from element.categories.mechanical import Structure
from element.categories.housing_spec import CADHousingSpec, HousingMaterial


class CADHousing(Structure):
    structural_role: Literal['housing'] = 'housing'
    cad_housing: CADHousingSpec


__all__ = ['CADHousing', 'CADHousingSpec', 'HousingMaterial']
