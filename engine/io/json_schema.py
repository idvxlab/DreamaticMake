from engine.io.load import RECORDS


def export_schema(record_kind: str) -> dict:
    if record_kind not in RECORDS:
        raise ValueError(f"Unsupported record kind: {record_kind}")
    return {"$schema": "https://json-schema.org/draft/2020-12/schema",
            **RECORDS[record_kind].model_json_schema()}
