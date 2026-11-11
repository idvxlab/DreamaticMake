"""Single-writer version store. One atomic pointer is the commit point, never N file renames."""
import json
import os
import shutil
import uuid
from contextlib import contextmanager
from pathlib import Path
from engine.query import QueryService
from engine.project_io import load_design_package


def atomic_json(path, value):
    tmp = path.with_name(uuid.uuid4().hex + '.tmp')
    with tmp.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


@contextmanager
def project_lock(path):
    with path.open('a+b') as stream:
        stream.seek(0, 2)
        if stream.tell() == 0: stream.write(b'0'); stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try: yield
        finally:
            stream.seek(0)
            if os.name == 'nt': msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class VersionStore:
    def __init__(self, directory, initial_root):
        self.directory = Path(directory).resolve()
        workspace = (Path(__file__).resolve().parents[1] / 'workspace').resolve()
        if not self.directory.is_relative_to(workspace): raise ValueError('Store must belong to workspace/')
        self.directory.mkdir(parents=True, exist_ok=True)
        self.initial = Path(initial_root).resolve(strict=True)

    def current_root(self):
        pointer = self.directory / 'current.json'
        if not pointer.exists(): return self.initial
        value = json.loads(pointer.read_text(encoding='utf-8'))['version']
        if len(value) != 32 or any(c not in '0123456789abcdef' for c in value): raise ValueError('Invalid version pointer')
        root = (self.directory / 'versions' / value).resolve(strict=True)
        if not root.is_relative_to(self.directory): raise ValueError('Version escapes store')
        return root

    def recover(self):
        with project_lock(self.directory / 'writer.lock'):
            return self._recover()

    def _recover(self):
        journal = self.directory / 'transaction.json'
        if not journal.exists(): return {'state': 'idle'}
        tx = json.loads(journal.read_text(encoding='utf-8'))
        pointer = self.directory / 'current.json'
        current = json.loads(pointer.read_text(encoding='utf-8')) if pointer.exists() else {}
        if current.get('version') == tx['version']:
            p = load_design_package(self.current_root())
            if p.snapshot_id != tx['snapshot_id']: raise ValueError('Committed version hash differs')
            tx['state'] = 'committed'
        else:
            tx['state'] = 'abandoned'
        atomic_json(journal, tx)
        return tx

    def commit_draft(self, candidate, *, base_snapshot_id, source_manifest_id, fault=lambda point: None):
        """Host API only. No model tool exposes this operation or approval decisions."""
        candidate = Path(candidate).resolve(strict=True)
        workspace = (Path(__file__).resolve().parents[1] / 'workspace').resolve()
        if not candidate.is_relative_to(workspace): raise ValueError('Unmanaged candidate')
        p = load_design_package(candidate)
        with project_lock(self.directory / 'writer.lock'):
            self._recover()
            current = QueryService(self.current_root(), 'store')
            if current.package.snapshot_id != base_snapshot_id or current.source_manifest() != source_manifest_id:
                raise ValueError('Stale integration baseline')
            version = uuid.uuid4().hex
            target = self.directory / 'versions' / version
            for path in candidate.rglob('*'):
                if path.is_symlink() or path.is_junction(): raise ValueError('Linked candidate files are unsupported')
            shutil.copytree(candidate, target, ignore=shutil.ignore_patterns('.*', '__pycache__'))
            if load_design_package(target).snapshot_id != p.snapshot_id: raise ValueError('Stored candidate differs')
            tx = {'version': version, 'snapshot_id': p.snapshot_id, 'base_snapshot_id': base_snapshot_id,
                  'state': 'prepared', 'engineering_outcome': 'unverified', 'receipt_kind': 'draft_version'}
            atomic_json(self.directory / 'transaction.json', tx)
            fault('prepared')
            atomic_json(self.directory / 'current.json', {'version': version})
            fault('pointer_switched')
            tx['state'] = 'committed'
            atomic_json(self.directory / 'transaction.json', tx)
            return tx
