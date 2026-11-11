from engine.io.load import RECORDS


def export_schema(record_kind: str) -> dict:
    if record_kind in ('design_package_v3', 'project_manifest_v3', 'element_definition_v2', 'execution_result_v1', 'scenario_v2'):
        from engine.design.professional import DesignPackageV3, Manifest
        from element.schema.professional import ElementDefinitionV2
        from engine.execution import ExecutionResult
        from engine.statechart import Scenario
        model = {'design_package_v3': DesignPackageV3, 'project_manifest_v3': Manifest,
            'element_definition_v2': ElementDefinitionV2, 'execution_result_v1': ExecutionResult, 'scenario_v2': Scenario}[record_kind]
        return {'$schema': 'https://json-schema.org/draft/2020-12/schema', **model.model_json_schema()}
    if record_kind in ('project_manifest', 'project_elements', 'project_library_element', 'project_documents'):
        from engine.project_io import ProjectManifest, ProjectElementIndex, LibraryElement, ProjectDocuments
        model = {'project_manifest': ProjectManifest, 'project_elements': ProjectElementIndex,
                 'project_library_element': LibraryElement, 'project_documents': ProjectDocuments}[record_kind]
        return {'$schema': 'https://json-schema.org/draft/2020-12/schema', **model.model_json_schema()}
    if record_kind in ('design_package', 'design_manifest'):
        return export_schema('design_package_v3' if record_kind == 'design_package' else 'project_manifest_v3')
    if record_kind in ('element_definition', 'element_ref', 'catalog_entry'):
        from element.io.records import export_schema as element_schema
        return element_schema(record_kind)
    if record_kind == "layout_project":
        from engine.layout_project import LayoutProject
        return {"$schema": "https://json-schema.org/draft/2020-12/schema", **LayoutProject.model_json_schema()}
    if record_kind == "layout_draft":
        from engine.layout import LayoutDraft
        return {"$schema": "https://json-schema.org/draft/2020-12/schema", **LayoutDraft.model_json_schema()}
    if record_kind == "assembly_design":
        from engine.io.design import AssemblyDesign
        return {"$schema": "https://json-schema.org/draft/2020-12/schema", **AssemblyDesign.model_json_schema()}
    if record_kind == "component_design":
        from element.categories import COMPONENT_ADAPTER
        return {"$schema": "https://json-schema.org/draft/2020-12/schema", **COMPONENT_ADAPTER.json_schema()}
    if record_kind not in RECORDS:
        raise ValueError(f"Unsupported record kind: {record_kind}")
    return {"$schema": "https://json-schema.org/draft/2020-12/schema",
            **RECORDS[record_kind].model_json_schema()}
