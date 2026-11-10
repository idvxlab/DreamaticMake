"""Result/artifact retrieval by managed IDs, never arbitrary browser paths."""
import base64
import hashlib
import json
import uuid
from element.io.package import package_file


def run_folder(context, run_id):
    if not isinstance(run_id,str) or str(uuid.UUID(run_id)) != run_id: raise ValueError('Invalid run ID')
    return context.workspace/'runs'/run_id


def stored_result(context,run_id):
    from .contracts import ToolRunResult
    from .presentation import present
    path = package_file(run_folder(context,run_id),'result.json')
    if path.stat().st_size > 16_000_000: raise ValueError('Result budget exceeded')
    result = ToolRunResult.model_validate_json(path.read_text(encoding='utf-8'))
    value = result.model_dump(mode='json')
    value['presentation'] = present(result,context.snapshot_id)
    return value


def artifact(context, run_id, artifact_id):
    result = stored_result(context,run_id)
    item = next((a for a in result['artifacts'] if a['id']==artifact_id),None)
    if item is None: raise ValueError('Artifact is not declared in this run')
    file = package_file(run_folder(context,run_id),item['path'])
    if not item['path'].startswith('artifacts/') or file.stat().st_size > 16_000_000: raise ValueError('Artifact budget exceeded')
    data = file.read_bytes()
    if hashlib.sha256(data).hexdigest() != item['sha256']: raise ValueError('Artifact hash differs')
    return {**item,'data_base64':base64.b64encode(data).decode('ascii')}
