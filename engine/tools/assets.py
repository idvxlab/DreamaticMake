"""Owner scoped, bounded, hash verified bytes; never pass project roots to workers."""
import hashlib
from pathlib import Path
from element.io.package import package_file

MAX_ASSET_BYTES = 32_000_000


def read_verified(resolver, owner, ref):
    if resolver is None: raise ValueError('Host asset resolver is required')
    if ref.relative_path and any(p.lower().startswith('.env') for p in Path(ref.relative_path).parts):
        raise ValueError('Secrets cannot be tool assets')
    data = resolver(owner, ref)
    if not isinstance(data, bytes) or len(data) > MAX_ASSET_BYTES: raise ValueError('Asset byte budget exceeded')
    if hashlib.sha256(data).hexdigest() != ref.sha256: raise ValueError('Asset hash differs from pin')
    return data


def file_resolver(roots):
    roots = {owner: Path(root).resolve(strict=True) for owner, root in roots.items()}
    def resolve(owner, ref):
        if owner not in roots or not ref.relative_path: raise ValueError('Unknown asset owner or namespace')
        if any(p.lower().startswith('.env') for p in Path(ref.relative_path).parts): raise ValueError('Secrets cannot be assets')
        path = package_file(roots[owner], ref.relative_path)
        with path.open('rb') as stream: return stream.read(MAX_ASSET_BYTES + 1)
    return resolve
