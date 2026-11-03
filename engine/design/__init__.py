"""Versioned design authoring: documents, functions, selection and five engineering domains."""
from engine.design.contracts import DesignManifest, DesignPackage
from engine.design.io import parse_record, parse_package, make_package, record_ref, snapshot_id
from engine.design.resolve import resolve_design
from engine.design.projection import project_design, check_design, compile_design
from engine.design.store import DesignStore, RevisionConflict

__all__ = ['DesignManifest', 'DesignPackage', 'parse_record', 'parse_package', 'make_package',
           'record_ref', 'snapshot_id', 'resolve_design', 'project_design', 'check_design', 'compile_design',
           'DesignStore', 'RevisionConflict', 'occurrence_ref', 'instantiate_element']

from engine.design.occurrence import occurrence_ref
from engine.design.selection import instantiate_element
