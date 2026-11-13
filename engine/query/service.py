"""Native v3 projections. Queries cannot select a filesystem root or mint evidence."""
import hashlib
import json
from pathlib import Path
from contextlib import contextmanager
from element.io.package import package_file
from element.io.load import read_record
from element.io.records import record_hash
from engine.project_io import load_design_package, ProjectDocuments
from engine.design.professional import resolved_poses, key
from engine.tools.source import pointer
from .contracts import QueryRequest, QueryResult


def digest(data):
    return hashlib.sha256(data).hexdigest()


def instance_owners(value):
    if isinstance(value, dict):
        return ({value['instance']} if isinstance(value.get('instance'), str) else set()).union(
            *(instance_owners(v) for v in value.values()))
    if isinstance(value, (list, tuple)):
        return set().union(*(instance_owners(v) for v in value))
    return set()


class QueryService:
    def __init__(self, root, handle, *, evidence_context=None):
        self.root = Path(root).resolve(strict=True)
        self.handle = handle
        self.package = load_design_package(self.root)
        self.evidence_context = evidence_context
        self._document_cache = None
        self._reading_documents = False

    @contextmanager
    def document_session(self):
        """One short-lived reference manifest per task preparation, never a global latest."""
        self._document_cache = None
        self._reading_documents = True
        try:
            yield
        finally:
            self._document_cache = None
            self._reading_documents = False

    def task_definition(self, kind):
        source = 'doc/tasks/index.json'
        docs = self.documents()
        if source not in docs: raise ValueError('Project must register doc/tasks/index.json')
        raw = package_file(self.root, source).read_bytes()
        if digest(raw) != docs[source]['content_hash']: raise ValueError('Task references changed during preparation')
        data = json.loads(raw)
        if data.get('schema_version') != 'project-task-context/1' or kind not in data.get('tasks', {}):
            raise ValueError('Project has no reference plan for this task')
        return data['tasks'][kind]

    def documents(self):
        if self._reading_documents and self._document_cache is not None:
            return self._document_cache
        p = self.package
        index = ProjectDocuments.model_validate_json(read_record(package_file(self.root, p.manifest.documents)))
        result = {}
        for stage, group in index.stages.items():
            for doc in group.files:
                # Only registered documents, no arbitrary file browser or hidden files.
                if any(part.startswith('.') for part in Path(doc.path).parts):
                    raise ValueError('Hidden documents are forbidden')
                target = package_file(self.root, doc.path)
                if not target.is_relative_to((self.root / 'doc').resolve()):
                    raise ValueError('Documents must belong to doc/')
                if target.stat().st_size > 20_000_000:
                    raise ValueError('Registered document exceeds size limit')
                result[doc.path] = {**doc.model_dump(mode='json'), 'source_id': doc.path,
                    'stage': stage, 'status': group.status, 'currency': doc.currency,
                    'content_hash': digest(target.read_bytes())}
        if self._reading_documents: self._document_cache = result
        return result

    def source_manifest(self):
        return record_hash(self.documents(), 'context-documents-v1')

    def query(self, request):
        q = request if isinstance(request, QueryRequest) else QueryRequest.model_validate_json(json.dumps(request))
        p, s = self.package, q.selector
        if q.project_handle != self.handle or q.snapshot_id != p.snapshot_id:
            raise ValueError('Project binding or snapshot is stale')
        ids = tuple(s.instances) or tuple(p.index.instances)
        registry = p.unit_occurrences()
        if set(ids) - registry.keys():
            raise ValueError('Unknown native instance handle')
        rows, sources, boundary, unknowns, attachments = [], [], [], [], []
        docs = self.documents()
        if q.method == 'project.overview':
            rows = [{'id': p.manifest.id, 'title': p.manifest.title,
                     'record_pins': p.manifest.model_dump(mode='json')['record_pins'],
                     'instances': len(p.index.instances), 'definitions': len(p.elements),
                     'source_manifest_id': self.source_manifest()}]
            unknowns.append({'owner': p.manifest.id, 'reason': 'Document currency and requirement confirmation require explicit review'})
        elif q.method.startswith('documents.') or q.method == 'requirements.query':
            selected = [d for d in docs.values() if not s.stage or d['stage'] == s.stage]
            if q.method == 'requirements.query':
                selected = [d for d in selected if d['stage'] == 'requirements']
            if s.source_id:
                if s.source_id not in docs: raise ValueError('Unregistered document')
                selected = [d for d in selected if d['source_id'] == s.source_id]
            if q.method == 'documents.read' and not s.source_id:
                raise ValueError('documents.read requires source_id')
            for d in selected:
                sources.append(d)
                if q.method == 'documents.list':
                    rows.append(d)
                    continue
                if d['media_type'] not in ('text/markdown', 'text/plain', 'application/json'):
                    attachments.append({**d, 'delivered': False})
                    unknowns.append({'owner': d['source_id'], 'reason': 'Binary asset has not been delivered or observed'})
                    continue
                raw = package_file(self.root, d['path']).read_bytes()
                if digest(raw) != d['content_hash']: raise ValueError('Document changed during preparation')
                lines = raw.decode('utf-8').splitlines()
                if q.method in ('documents.search', 'requirements.query'):
                    for n, line in enumerate(lines, 1):
                        if not s.text or s.text.casefold() in line.casefold():
                            rows.append({'source_id': d['source_id'], 'start_line': n, 'end_line': n,
                                         'text': line, 'interpretation': 'source_excerpt', 'confirmation': 'unclassified'})
                else:
                    if s.end_line < s.start_line or s.end_line - s.start_line > 500:
                        raise ValueError('Invalid bounded document range')
                    rows.append({'source_id': d['source_id'], 'start_line': s.start_line,
                                 'end_line': min(s.end_line, len(lines)),
                                 'headings': [v for v in lines[:s.start_line-1] if v.startswith('#')],
                                 'text': '\n'.join(lines[s.start_line-1:s.end_line])})
        elif q.method in ('instances.inspect', 'elements.inspect'):
            seen = set()
            for i in ids:
                node = registry[i]
                ref = node.element_ref
                sources.append({'source_id': i, 'element_ref': ref.model_dump(mode='json'),
                                'content_hash': ref.content_hash, 'pointer': node.pointer, 'path': node.location.path})
                if q.method == 'instances.inspect':
                    rows.append({'instance': i, 'element_ref': ref.model_dump(mode='json'),
                                 'unit_path': i.split('/')[1:], 'location':node.location.model_dump(mode='json'),
                                 'children': list(node.definition.units)})
                elif (ref.content_hash, node.pointer) not in seen:
                    d = p.definition(i).model_dump(mode='json')
                    value = d if q.facet == 'native' else {k: d[k] for k in ('id', 'name', 'category', q.facet) if k in d}
                    rows.append({'element_ref': ref.model_dump(mode='json'), 'instances': [j for j,n in registry.items()
                        if n.element_ref == ref and n.pointer == node.pointer], 'definition': value})
                    seen.add((ref.content_hash, node.pointer))
        elif q.method == 'layout.inspect':
            poses = resolved_poses(p)  # Always solve the complete forest.
            rows = [{'instance': i, 'links': {r: v.model_dump(mode='json') for r, v in poses.items() if r.startswith(i+'/')},
                     'units': 'm', 'frame': p.structure.frame_id} for i in ids]
            joints = p.effective_joints()
            ancestors = {r for r in poses if any(r.startswith(i+'/') for i in ids)}
            while True:
                old = set(ancestors)
                for joint in joints.values():
                    if key(joint.child) in ancestors: ancestors.add(key(joint.parent))
                for ref, placement in p.structure.placements.items():
                    if ref in ancestors: ancestors.add(key(placement.relative_to))
                if old == ancestors: break
            boundary = [{'kind': 'motion_ancestors', 'joints': {k: v.model_dump(mode='json') for k, v in joints.items() if key(v.child) in ancestors},
                         'initial_positions': {k: v for k, v in p.motion.initial_positions.items() if key(joints[k].child) in ancestors},
                         'root_placements': p.structure.model_dump(mode='json')['root_placements'],
                         'placements': {k: v.model_dump(mode='json') for k, v in p.structure.placements.items() if k in ancestors},
                         'mount_connections': {k: v for k, v in p.effective_mount_connections().items()
                             if instance_owners(v).intersection(ids)}}]
            unknowns.append({'owner': 'layout', 'reason': 'Spatial AABB neighborhood unavailable; no collision conclusion'})
        elif q.method == 'circuit.inspect':
            e = p.circuit_logic
            rows = [{'instance': i, 'pins': {ref: pin.model_dump(mode='json') for ref,pin in p.occurrences('electrical','pins').items()
                if ref.startswith(i+'/')},
                     'configuration_coupling': 'Library capability may contain project GPIO settings'} for i in ids]
            boundary = [{'kind': 'global_electrical_constraints', **e.model_dump(mode='json'),
                         'nets':{id:n.model_dump(mode='json') for id,n in p.effective_nets().items()}}]
        elif q.method == 'evidence.query':
            if not s.run_ids:
                unknowns.append({'owner': 'evidence', 'reason': 'No execution run IDs selected; no coverage claim'})
            if self.evidence_context is None:
                unknowns.append({'owner': 'evidence', 'reason': 'No host evidence store bound; reports in documents are not current execution evidence'})
            else:
                from engine.tools.host import stored_result
                for run_id in s.run_ids:
                    value = stored_result(self.evidence_context, run_id)
                    rows.append({**value, 'stale': value['evidence'].get('subject_snapshot_id') != p.snapshot_id})
        else:
            unknowns.append({'owner': q.method, 'reason': 'unsupported'})
        if not sources and not q.method.startswith('documents.'):
            sources = [{'source_id': name, 'content_hash': pin.content_hash, 'pointer': '/',
                        'revision': pin.revision} for name, pin in p.manifest.record_pins.items()]
        total = len(rows)
        rows = rows[:q.budget.max_items]
        omitted = [] if total == len(rows) else [{'reason': 'max_items', 'count': total-len(rows), 'action': 'narrow selector'}]
        envelope = dict(snapshot_id=p.snapshot_id, schema_ref=q.method+'/1', data=tuple(rows), sources=tuple(sources),
                        boundary=tuple(boundary), unknowns=tuple(unknowns), attachments=tuple(attachments),
                        included=tuple(ids) if q.method.endswith('.inspect') else (), omitted=tuple(omitted))
        # UTF-8 byte count is deliberately conservative; includes provenance and boundaries.
        estimate = len(json.dumps(envelope, ensure_ascii=False).encode('utf-8')) + 512
        completeness = 'partial' if omitted or unknowns or attachments else 'complete'
        if estimate > q.budget.max_text_tokens:
            envelope.update(data=(), boundary=(), sources=(), attachments=(), unknowns=(), included=(),
                            omitted=({'reason': 'max_text_tokens', 'required_estimate': estimate, 'action': 'narrow scope or raise budget'},))
            completeness = 'needs_narrower_scope'
        usage = {'estimated_text_tokens': len(json.dumps(envelope, ensure_ascii=False).encode('utf-8'))+256,
                 'estimate_method': 'utf8_bytes_upper_bound', 'images_delivered': 0}
        return QueryResult(query_id=record_hash({'request': q.model_dump(mode='json'), 'documents': self.source_manifest()}, 'context-query-v1'),
                           **envelope, usage=usage, completeness=completeness)
