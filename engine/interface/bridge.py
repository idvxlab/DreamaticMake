"""Read-only example browser bridge; receives bounded JSON from the local UI server."""
import json
import sys
from pathlib import Path
from element.io.components import load_component
from element.library import ElementLibrary
from element.schema.library import ElementDefinition, ElementQuery
from engine.layout import import_layout, dispatch_layout

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / 'examples'


def catalog():
    library = ElementLibrary(ROOT / 'workspace/element-library')
    for path in sorted((EXAMPLES / 'element').glob('*.json')):
        if path.name.endswith('.scenario.json'): continue
        model = load_component(path)
        definition = ElementDefinition(library_id='templates', element_id=model.id,
            revision=model.revision, name=model.name, category=model.category, origin='template', model=model)
        from element.io.records import element_ref
        if element_ref(definition) not in library.versions('templates', model.id):
            library.publish(definition)
    return library


def designs():
    result = {'gripper': {'title': '双指机械夹爪', 'level': 'engine', 'path': EXAMPLES / 'engine/gripper.project.json'},
              'project_1': {'title': '项目 1 · 迷你机械臂与夹爪', 'level': 'project', 'path': EXAMPLES / 'project_1'}}
    for path in sorted((EXAMPLES / 'engine').glob('*.bundle.json')):
        result['engine.' + path.stem.split('.')[0]] = {'title': path.stem.split('.')[0], 'level': 'engine', 'path': path}
    for path in sorted((EXAMPLES / 'element').glob('*.json')):
        if path.name.endswith('.scenario.json'): continue
        result['element.' + path.stem] = {'title': json.loads(path.read_text(encoding='utf-8'))['name'], 'level': 'element', 'path': path}
    return result


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def handle(request):
    if request['method'] == 'list':
        return [{'id': key, 'title': value['title'], 'level': value['level']} for key, value in designs().items()]
    if request['method'] == 'search':
        library = catalog()
        result = library.search(ElementQuery(text=request.get('text', ''), categories=tuple(request.get('categories', [])), limit=100))
        for hit in result['items']:
            hit['definition'] = library.get(hit['ref']).model_dump(mode='json')
        return result
    if request['method'] != 'view': raise ValueError('Unknown operation')
    item = designs()[request['id']]
    path = item['path']
    scenario = None
    if path.is_dir():
        source = {'record_kind': 'layout_project', 'project_version': 1,
                  'components': {p.stem: read(p) for p in (path / 'components').glob('*.json')}}
        for key, filename in [('structure', 'structure'), ('motion', 'motion'), ('circuit_energy', 'circuit-energy'), ('flow', 'flow')]:
            source[key] = read(path / 'design' / (filename + '.json'))
    else:
        source = read(path)
        scenario_path = path.with_name(path.name.replace('.bundle.json', '.scenario.json') if '.bundle.' in path.name else path.stem + '.scenario.json')
        if scenario_path.exists(): scenario = read(scenario_path)
    draft = import_layout(source, scenario)
    result = dispatch_layout('layout_motion', {'draft': draft, 'joint_inputs': request.get('joint_inputs', {})})
    return {'source': source, **result}


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(1_000_001)
        if len(data) > 1_000_000: raise ValueError('Request too large')
        print(json.dumps(handle(json.loads(data)), ensure_ascii=False, allow_nan=False))
    except (ValueError, KeyError, OSError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        sys.exit(2)
