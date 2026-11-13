"""Optional application-owned repository: atomic CAS commits, immutable records, no approvals."""
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from engine.design.io import parse_package, snapshot_id, record_ref
from engine.design.resolve import resolve_design
from element.io.save import canonical_json

class RevisionConflict(ValueError):
    pass

class DesignStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS design_heads(design_id TEXT PRIMARY KEY, revision INTEGER);
                CREATE TABLE IF NOT EXISTS design_snapshots(design_id TEXT, revision INTEGER, hash TEXT, data TEXT,
                    PRIMARY KEY(design_id,revision));
                CREATE TABLE IF NOT EXISTS design_records(design_id TEXT, record_id TEXT, revision INTEGER, hash TEXT,
                    PRIMARY KEY(design_id,record_id,revision));
            ''')

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=20)
        try:
            with db: yield db
        finally: db.close()

    def commit(self, package, *, expected_manifest_revision):
        package = parse_package(package)
        resolve_design(package)  # validates pins, but incomplete design references remain editable
        m = package.manifest
        if m.revision != expected_manifest_revision + 1: raise RevisionConflict('New revision must increment expected head')
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision FROM design_heads WHERE design_id=?', (m.design_id,)).fetchone()
            if (row[0] if row else 0) != expected_manifest_revision:
                raise RevisionConflict('revision_conflict')
            for record in package.records:
                ref = record_ref(record)
                key = (m.design_id, ref.record_id, ref.revision)
                previous = db.execute('SELECT hash FROM design_records WHERE design_id=? AND record_id=? AND revision=?', key).fetchone()
                if previous and previous[0] != ref.content_hash: raise RevisionConflict('Record revision is immutable')
                db.execute('INSERT OR IGNORE INTO design_records VALUES (?,?,?,?)', (*key, ref.content_hash))
            db.execute('INSERT INTO design_snapshots VALUES (?,?,?,?)', (m.design_id, m.revision, snapshot_id(m), canonical_json(package)))
            db.execute('INSERT OR REPLACE INTO design_heads VALUES (?,?)', (m.design_id, m.revision))
        return snapshot_id(m)

    def read(self, design_id, revision=None):
        with self._db() as db:
            if revision is None:
                head = db.execute('SELECT revision FROM design_heads WHERE design_id=?', (design_id,)).fetchone()
                if not head: raise ValueError('Unknown design')
                revision = head[0]
            row = db.execute('SELECT hash,data FROM design_snapshots WHERE design_id=? AND revision=?', (design_id, revision)).fetchone()
        if not row: raise ValueError('Unknown design revision')
        package = parse_package(row[1])
        resolve_design(package)
        if snapshot_id(package.manifest) != row[0]: raise ValueError('Stored snapshot hash mismatch')
        return package
