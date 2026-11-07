"""Explicit, read-only project folder input. Resolves pinned library or local elements."""
import json
from pathlib import Path
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Id
from element.io.load import _record_object, read_record
from element.io.package import package_file, pool_root
from element.io.components import load_component
from element.io.records import record_hash
from element.schema.library import ElementRef
from engine.layout_project import LayoutProject
from element.interfaces.software import SoftwareProject


class DesignFiles(Contract):
    structure: str = 'design/structure.json'
    motion: str = 'design/motion.json'
    circuit_logic: str = 'design/circuit-logic.json'


class ProjectManifest(Contract):
    record_kind: Literal['project_manifest'] = 'project_manifest'
    project_version: Literal[2] = 2
    id: Id
    title: str
    summary: str = ''
    element_index: str = 'element/index.json'
    design: DesignFiles = DesignFiles()
    documents: str = 'doc/index.json'


class ElementLocation(Contract):
    kind: Literal['library', 'custom']
    path: str
    software: SoftwareProject | None = None


class ProjectElementIndex(Contract):
    record_kind: Literal['project_elements'] = 'project_elements'
    schema_version: Literal['1'] = '1'
    elements: dict[Id, ElementLocation] = Field(min_length=1, max_length=64)


class LibraryElement(Contract):
    record_kind: Literal['project_library_element'] = 'project_library_element'
    schema_version: Literal['1'] = '1'
    pool: Literal['default'] = 'default'
    folder: str = Field(min_length=1, max_length=200, pattern=r'^[^/\\:]+$')
    ref: ElementRef


class ProjectDocument(Contract):
    path: str
    media_type: str
    title: str


class StageDocuments(Contract):
    status: Literal['draft', 'reference', 'reviewed'] = 'draft'
    files: tuple[ProjectDocument, ...] = Field(default=(), max_length=128)


class ProjectDocuments(Contract):
    record_kind: Literal['project_documents'] = 'project_documents'
    schema_version: Literal['1'] = '1'
    stages: dict[Id, StageDocuments] = Field(default_factory=dict, max_length=32)


def _read(folder, path):
    target = package_file(folder, path)
    if target.suffix != '.json': raise ValueError('Project records must use JSON')
    return _record_object(read_record(target))


def load_project(path, *, element_pool=None):
    """Load a project folder/project.json into an inline v2 record, without execution.

    Project paths are confined to the project; local definitions to element/;
    the configured library is the only separately trusted root. Missing contract
    fields retain native defaults; missing library pins never become local copies.
    """
    path = Path(path)
    root = (path if path.is_dir() else path.parent).resolve(strict=True)
    filename = 'project.json' if path.is_dir() else path.name
    manifest = ProjectManifest.model_validate_json(json.dumps(_read(root, filename)))
    index_path = package_file(root, manifest.element_index)
    element_root = (root / 'element').resolve(strict=True)
    if not element_root.is_relative_to(root) or not index_path.is_relative_to(element_root):
        raise ValueError('Element index must belong to project element/')
    index = ProjectElementIndex.model_validate_json(json.dumps(_read(root, manifest.element_index)))
    pool = None
    components, sources = {}, {}
    cache = {}
    for key, location in index.elements.items():
        if location.kind == 'library':
            reference = LibraryElement.model_validate_json(json.dumps(_read(element_root, location.path)))
            if pool is None:
                from element.library.pool import load_element_pool
                pool = load_element_pool(element_pool if element_pool is not None else pool_root())
            record = next((r for r in pool.records if r.native_ref == reference.ref and not r.blockers), None)
            if record is None or record.definition is None:
                raise ValueError('Library element pin is unavailable or not admitted: ' + key)
            if record.detail.get('asset_root') != reference.folder:
                raise ValueError('Library folder differs from pinned element location: ' + key)
            model = record.definition.model
            sources[key] = {'kind': 'library', 'path': location.path, 'folder': reference.folder,
                'ref': reference.ref.model_dump(mode='json')}
        else:
            # Resolve the folder via its manifest to enforce both root and symlink confinement.
            package_manifest = package_file(element_root, location.path + '/manifest.json')
            folder = package_manifest.parent
            if folder not in cache: cache[folder] = load_component(folder)
            model = cache[folder]
            sources[key] = {'kind': 'custom', 'path': location.path,
                'content_hash': record_hash(model.model_dump(mode='json'), 'project-component-v1')}
        components[key] = model.model_dump(mode='json')
        if location.software is not None:
            if model.category != 'controller':
                raise ValueError('Only controller instances may bind software: ' + key)
            components[key]['software'] = location.software.model_dump(mode='json')
            sources[key]['software'] = location.software.model_dump(mode='json')
    documents = ProjectDocuments.model_validate_json(json.dumps(_read(root, manifest.documents)))
    for stage in documents.stages.values():
        for file in stage.files:
            target = package_file(root, file.path)
            doc_root = (root / 'doc').resolve(strict=True)
            if not target.is_relative_to(doc_root): raise ValueError('Documents must belong to doc/')
    source = {'record_kind': 'layout_project', 'project_version': 2, 'elements': components,
        'element_sources': sources, **{key: _read(root, relative)
            for key, relative in manifest.design.model_dump().items()}}
    return LayoutProject.model_validate_json(json.dumps(source, allow_nan=False)).model_dump(mode='json')


def project_source_files(path):
    """Display authoring files with references, rather than a copy of resolved elements."""
    path = Path(path)
    root = (path if path.is_dir() else path.parent).resolve(strict=True)
    filename = 'project.json' if path.is_dir() else path.name
    data = _read(root, filename)
    manifest = ProjectManifest.model_validate_json(json.dumps(data))
    paths = (manifest.element_index, *manifest.design.model_dump().values(), manifest.documents)
    return {filename: data, **{relative: _read(root, relative) for relative in paths}}
