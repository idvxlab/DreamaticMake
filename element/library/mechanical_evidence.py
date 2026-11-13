"""Read and verify mechanical evidence linked to a specific catalog element."""
from hashlib import file_digest
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from element.io.package import package_file


def _asset(folder, relative, digest, kind):
    try:
        path = package_file(folder, relative)
        if not 0 < path.stat().st_size <= 32 * 1024 * 1024:
            return None
        with path.open('rb') as stream:
            header = stream.read(64).lstrip()
            signatures = {'.step': b'ISO-10303-21;', '.stp': b'ISO-10303-21;', '.pdf': b'%PDF-'}
            suffix = path.suffix.lower()
            if suffix not in (('.step', '.stp') if kind == 'step' else ('.pdf',)):
                return None
            if not header.startswith(signatures[suffix]):
                return None
            stream.seek(0)
            actual = file_digest(stream, 'sha256').hexdigest()
        if actual != digest:
            return None
        return {'kind': kind, 'path': str(path), 'sha256': actual}
    except (OSError, ValueError, TypeError):
        return None


def mechanical_evidence(root: Path, record):
    definition = record.definition
    if not definition or definition.origin != 'catalog' or not definition.product.model or not record.detail:
        return None
    folder = root / record.detail['asset_root']
    # Explicit catalog annotations attest to the exact model and drawing locator.
    for evidence_id, kind in (('mechanical_step', 'step'), ('dimensioned_drawing', 'drawing')):
        evidence = definition.evidence.get(evidence_id)
        if evidence and evidence.basis == 'datasheet' and evidence.source_ids and evidence.statement.strip():
            for ref in evidence.artifact_refs:
                if ref.relative_path and (asset := _asset(folder, ref.relative_path, ref.sha256, kind)):
                    return {**asset, 'locator': evidence.statement}
        if kind == 'step' and (asset := _manufacturer_archive(folder, record)):
            return asset
    return None


def _manufacturer_archive(folder, record):
    # The existing Arduino package supplies the manufacturer's model as a ZIP.
    # Verify the extracted STEP byte-for-byte against the pinned archive member.
    if record.ref.element_id != 'arduino_kit.arduino_uno_r4_wifi':
        return None
    for source in record.detail.get('source_manifest', ()):
        if source.get('url') != 'https://docs.arduino.cc/resources/models/ABX00087-step.zip':
            continue
        try:
            archive = package_file(folder, source['local_path'])
            if archive.stat().st_size > 32 * 1024 * 1024:
                return None
            with archive.open('rb') as stream:
                if file_digest(stream, 'sha256').hexdigest() != source.get('sha256'):
                    return None
            with ZipFile(archive) as bundle:
                member = bundle.getinfo('UNO_R4_WIFI.step')
                if member.file_size > 32 * 1024 * 1024:
                    return None
                with bundle.open(member) as stream:
                    digest = file_digest(stream, 'sha256').hexdigest()
            return _asset(folder, 'assets/reference.step', digest, 'step')
        except (OSError, ValueError, KeyError, BadZipFile):
            return None
    return None
