"""Content keys and atomic run publication. Unknown results are never cached as passes."""
import json
from element.io.records import record_hash


def dependency_key(value): return record_hash(value, 'tools-dependencies-v1')


def publish(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=True, allow_nan=False), encoding='utf-8')
    temporary.replace(path)
