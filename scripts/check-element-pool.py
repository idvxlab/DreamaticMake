"""Read-only smoke test against the user's element_pool, without copying its assets."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from element.library.pool import load_element_pool
from engine.element_search import ElementSearchTool


def verify_pool(root):
    root = Path(root).resolve()
    paths = [root/'index.json', *root.glob('*/structured.json'), *root.glob('*/element.json'),
             *root.glob('*/component.json'), *root.glob('*/manifest.json')]
    def fingerprints():
        return {p.relative_to(root).as_posix(): sha256(p.read_bytes()).hexdigest() for p in paths}
    before = fingerprints()
    retriever = load_element_pool(root)
    tool = ElementSearchTool(retriever)
    cases = (
        ('找一个6V直流电机，空载转速至少10000rpm', 'arduino_kit.dc_motor_130_6v', True, 'match'),
        ('找一个5V供电的测温传感器', 'arduino_kit.tmp36', False, 'match'),
        ('5V舵机', 'arduino_kit.servo_sg90', False, 'unknown'),
        ('220Ω电阻', 'arduino_kit.resistor_220ohm', True, 'match'),
        ('电机持续扭矩至少0.1N*m', 'arduino_kit.dc_motor_130_6v', True, 'unknown'),
    )
    results = []
    for text, element_id, selectable, outcome in cases:
        result = tool.call('element_search', {'text': text})
        candidate = next(c for c in result['items'] if c['ref']['element_id'] == element_id)
        assert candidate['selectable'] == selectable, text
        assert all(a['outcome'] == outcome for a in candidate['assessments']), text
        detail = tool.call('element_inspect', candidate['ref'])
        assert detail['native_ref'] == candidate['native_ref']
        results.append({'text': text, 'candidate': element_id, 'selectable': selectable,
            'assessments': [{k: a[k] for k in ('parameter_codes', 'outcome')} for a in candidate['assessments']]})
    assert fingerprints() == before, 'Source JSON changed during read-only retrieval'
    return {'records': len(retriever.records), 'selectable': sum(r.native_ref is not None for r in retriever.records),
        'index_generation': retriever.generation, 'checked_source_files': len(paths),
        'source_json_unchanged': True, 'cases': results, 'diagnostics': list(retriever.diagnostics)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root')
    args = parser.parse_args()
    print(json.dumps(verify_pool(args.root), ensure_ascii=True, indent=2))
