"""Immutable source files and a replaceable transactional SQLite search index."""
import base64
import json
import re
import sqlite3
import unicodedata
from pathlib import Path
from uuid import uuid4
from element.io.load import _record_object, MAX_BYTES
from element.io.save import canonical_json, save
from element.io.records import parse_element, element_ref, record_hash
from element.schema.library import ElementRef, ElementQuery, CatalogEntry

class LibraryError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

def normalize(text):
    return unicodedata.normalize('NFKC', text).casefold()

def tokens(text):
    text = normalize(text)
    words = re.findall(r'[a-z0-9_.-]+|[\u3400-\u9fff]+', text)
    result = set()
    for word in words:
        if re.search(r'[\u3400-\u9fff]', word):
            result.update(word[i:i+2] for i in range(max(1, len(word)-1)))
        else:
            result.add(word)
    return sorted(result)

class ElementLibrary:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / 'index.sqlite3'
        if not self.db_path.resolve().is_relative_to(self.root):
            raise LibraryError('path_escape', 'Index escapes library root')
        with self._db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS versions (
                    library_id TEXT, element_id TEXT, revision INTEGER, hash TEXT,
                    name TEXT, category TEXT, status TEXT, search_text TEXT, exact_names TEXT,
                    capabilities TEXT, protocols TEXT, parameters TEXT,
                    PRIMARY KEY(library_id, element_id, revision));
                CREATE INDEX IF NOT EXISTS category_status ON versions(category, status);
                CREATE TABLE IF NOT EXISTS terms (
                    term TEXT, library_id TEXT, element_id TEXT, revision INTEGER,
                    PRIMARY KEY(term, library_id, element_id, revision));
            ''')
            db.execute('INSERT OR IGNORE INTO meta VALUES (?, ?)', ('generation', uuid4().hex))

    def _db(self):
        # Each operation owns/closes its connection (important for Windows file handles).
        from contextlib import contextmanager
        @contextmanager
        def connection():
            db = sqlite3.connect(self.db_path, timeout=20)
            db.row_factory = sqlite3.Row
            try:
                with db: yield db
            finally: db.close()
        return connection()

    def _path(self, ref):
        target = self.root / 'definitions' / ref.library_id / ref.element_id / f'{ref.revision}.json'
        if not target.resolve().is_relative_to(self.root):
            raise LibraryError('path_escape', 'Definition escapes library root')
        return target

    def _read(self, path):
        if not path.resolve().is_relative_to(self.root):
            raise LibraryError('path_escape', 'Source escapes library root')
        with path.open('rb') as stream: data = stream.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES: raise LibraryError('size_limit', 'Source is too large')
        return _record_object(data.decode('utf-8'))

    def get(self, ref):
        ref = ElementRef.model_validate_json(canonical_json(ref))
        try: value = parse_element(self._read(self._path(ref)))
        except FileNotFoundError as exc:
            raise LibraryError('not_found', 'Pinned element version is unavailable') from exc
        if element_ref(value) != ref:
            raise LibraryError('hash_mismatch', 'Pinned element contents do not match')
        return value

    def publish(self, definition):
        definition = parse_element(definition)
        ref = element_ref(definition)
        target = self._path(ref)
        target.parent.mkdir(parents=True, exist_ok=True)
        # SQLite serializes publishers and index builders. Files are immutable; a failed
        # indexing transaction leaves a recoverable source and the old index generation.
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            if target.exists():
                if element_ref(parse_element(self._read(target))) != ref:
                    raise LibraryError('version_conflict', 'Cannot replace a published revision')
            else:
                save(definition, target, overwrite=True)
            self._index(db, definition, self._catalog(ref))
            self._generation(db)
        return ref

    def _catalog(self, ref):
        folder = self._path(ref).parent / f'{ref.revision}.catalog'
        if not folder.exists(): return CatalogEntry(ref=ref)
        entries = list(folder.glob('*.json'))
        if not entries: return CatalogEntry(ref=ref)
        entry = CatalogEntry.model_validate_json(canonical_json(self._read(max(entries, key=lambda p: int(p.stem)))))
        if entry.ref != ref: raise LibraryError('catalog_conflict', 'Catalog points at another definition')
        return entry

    def update_catalog(self, entry):
        entry = CatalogEntry.model_validate_json(canonical_json(entry))
        definition = self.get(entry.ref)
        for ref in entry.replacement_refs: self.get(ref)
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = self._catalog(entry.ref)
            folder = self._path(entry.ref).parent / f'{entry.ref.revision}.catalog'
            target = folder / f'{entry.catalog_revision}.json'
            if not target.resolve().is_relative_to(self.root):
                raise LibraryError('path_escape', 'Catalog escapes library root')
            if target.exists():
                if self._read(target) != entry.model_dump(mode='json'):
                    raise LibraryError('catalog_conflict', 'Catalog revision is immutable')
            else:
                if folder.exists() and entry.catalog_revision <= previous.catalog_revision:
                    raise LibraryError('catalog_conflict', 'Catalog revision must increase')
                folder.mkdir(parents=True, exist_ok=True)
                save(entry, target, overwrite=True)
            self._index(db, definition, self._catalog(entry.ref))
            self._generation(db)

    def _generation(self, db):
        generation = uuid4().hex
        db.execute('UPDATE meta SET value=? WHERE key=?', (generation, 'generation'))
        return generation

    def _index(self, db, definition, catalog):
        d = definition
        ref = element_ref(d)
        exact = [normalize(x) for x in (d.name, *d.aliases, d.product.model or '') if x]
        text = normalize(' '.join([d.name, *d.aliases, d.product.model or '', d.description_markdown]))
        protocols = sorted({i.protocol for i in getattr(d.model, 'interfaces', {}).values()})
        parameters = {}
        for name, p in d.parameters.items():
            bounds = p.limits or (type('Bounds', (), {'min': p.value, 'max': p.value}) if p.value else None)
            if not bounds: continue
            verified = bool(p.evidence_ids) and any(d.evidence[e].basis != 'assumption' for e in p.evidence_ids)
            parameters[name] = {'min': bounds.min.si_value, 'max': bounds.max.si_value,
                                'dimension': bounds.min.dimension, 'verified': verified}
        db.execute('INSERT OR REPLACE INTO versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                   (d.library_id, d.element_id, d.revision, ref.content_hash, d.name, d.category,
                    catalog.status, text, json.dumps(exact), json.dumps([c.code for c in d.capabilities.values()]),
                    json.dumps(protocols), json.dumps(parameters)))
        key = (d.library_id, d.element_id, d.revision)
        db.execute('DELETE FROM terms WHERE library_id=? AND element_id=? AND revision=?', key)
        db.executemany('INSERT INTO terms VALUES (?,?,?,?)', [(term, *key) for term in tokens(text)])

    def rebuild_index(self):
        count = 0
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM versions')
            db.execute('DELETE FROM terms')
            for path in sorted((self.root / 'definitions').glob('*/*/*.json')):
                definition = parse_element(self._read(path))
                ref = element_ref(definition)
                if path.resolve() != self._path(ref).resolve():
                    raise LibraryError('identity_mismatch', 'Definition stored at the wrong identity')
                self._index(db, definition, self._catalog(ref))
                count += 1
            generation = self._generation(db)
        return {'generation': generation, 'indexed_count': count}

    def versions(self, library_id, element_id):
        # Validate identifiers before source path access; this also works after index loss.
        stub = ElementRef(library_id=library_id, element_id=element_id, revision=1, content_hash='0'*64)
        result = []
        for path in self._path(stub).parent.glob('*.json'):
            definition = parse_element(self._read(path))
            ref = element_ref(definition)
            if self._path(ref).resolve() != path.resolve():
                raise LibraryError('identity_mismatch', 'Definition identity mismatch')
            result.append(ref)
        return sorted(result, key=lambda r: r.revision)

    def search(self, query):
        query = ElementQuery.model_validate_json(canonical_json(query))
        fingerprint = record_hash(query.model_dump(mode='json', exclude={'cursor'}), 'element-query-v1')
        with self._db() as db:
            db.execute('BEGIN')
            generation = db.execute('SELECT value FROM meta WHERE key=?', ('generation',)).fetchone()[0]
            after = None
            if query.cursor:
                try:
                    cursor = json.loads(base64.urlsafe_b64decode(query.cursor).decode('utf-8'))
                    if cursor['query'] != fingerprint: raise ValueError()
                    if cursor['generation'] != generation:
                        raise LibraryError('index_changed', 'Index changed; restart search')
                    after = tuple(cursor['after'])
                    if len(after) != 4: raise ValueError()
                except LibraryError: raise
                except (ValueError, KeyError, TypeError, UnicodeError) as exc:
                    raise LibraryError('invalid_cursor', 'Cursor does not match the query') from exc
            sql = 'SELECT v.* FROM versions v WHERE 1=1'
            args = []
            if not query.include_deprecated: sql += " AND v.status='active'"
            if query.categories:
                sql += ' AND v.category IN (' + ','.join('?' for _ in query.categories) + ')'
                args.extend(query.categories)
            if query.version_policy == 'latest_active':
                sql += " AND v.revision=(SELECT MAX(w.revision) FROM versions w WHERE w.library_id=v.library_id AND w.element_id=v.element_id AND w.status='active')"
            for term in tokens(query.text):
                sql += ' AND EXISTS(SELECT 1 FROM terms t WHERE t.term=? AND t.library_id=v.library_id AND t.element_id=v.element_id AND t.revision=v.revision)'
                args.append(term)
            rows = db.execute(sql, args).fetchall()
        hits = []
        for row in rows:
            if set(query.capability_codes) - set(json.loads(row['capabilities'])): continue
            if set(query.protocols) - set(json.loads(row['protocols'])): continue
            parameters = json.loads(row['parameters'])
            matches = True
            for f in query.numeric:
                p = parameters.get(f.parameter_code)
                if not p or p['dimension'] != f.min.dimension or (not query.include_assumptions and not p['verified']):
                    matches = False; break
                a, b, low, high = p['min'], p['max'], f.min.si_value, f.max.si_value
                match = {'within': low <= a <= b <= high, 'contains': a <= low <= high <= b,
                         'overlaps': max(a, low) <= min(b, high)}[f.relation]
                if not match: matches = False; break
            if not matches: continue
            rank = 0 if normalize(query.text) in json.loads(row['exact_names']) else 1
            key = (rank, row['library_id'], row['element_id'], row['revision'])
            if after is not None and key <= after: continue
            hits.append((key, row))
        hits.sort(key=lambda pair: pair[0])
        page = hits[:query.limit]
        next_cursor = None
        if len(hits) > query.limit:
            next_cursor = base64.urlsafe_b64encode(canonical_json({'generation': generation,
                'query': fingerprint, 'after': page[-1][0]}).encode()).decode()
        return {'items': [{'ref': {'library_id': r['library_id'], 'element_id': r['element_id'],
                    'revision': r['revision'], 'content_hash': r['hash']},
                    'name': r['name'], 'category': r['category'],
                    'matched_fields': ['text'] if query.text else [], 'missing_parameters': []} for _, r in page],
                'index_generation': generation, 'next_cursor': next_cursor}
