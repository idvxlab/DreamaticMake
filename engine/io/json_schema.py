from engine.io.load import RECORDS


def export_schema(record_kind: str) -> dict:
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
        from engine.components import COMPONENT_ADAPTER
        return {"$schema": "https://json-schema.org/draft/2020-12/schema", **COMPONENT_ADAPTER.json_schema()}
    if record_kind not in RECORDS:
        raise ValueError(f"Unsupported record kind: {record_kind}")
    return {"$schema": "https://json-schema.org/draft/2020-12/schema",
            **RECORDS[record_kind].model_json_schema()}
