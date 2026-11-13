"""Supplier offers kept separate from engineering definitions and approvals."""
import json
import os
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit

from element.io.package import pool_settings
from element.io.records import record_hash
from element.library.local import normalize
from element.library.retrieval import SearchRecord
from element.schema.retrieval import PurchaseLink, RetrievalRef


def _supplier(url):
    try:
        address = urlsplit(url)
        if address.scheme != 'https' or not address.hostname or address.username or address.password:
            return None
        if any(char.isspace() or char in '<>\\|' for char in url):
            return None
        return address.hostname.removeprefix('www.')
    except ValueError:
        return None


def _catalog_path():
    directory, settings = pool_settings()
    configured = os.environ.get('DREAMATIC_PROCUREMENT_CATALOG')
    configured = configured or settings.get('procurement_catalog')
    return (directory / configured).resolve() if configured else None


def _seed_offers():
    path = _catalog_path()
    if not path or not path.is_file():
        return []
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)
    try:
        rows = connection.execute(
            "SELECT id, category, title, model, data_json FROM items WHERE source = 'SeedComponents' LIMIT 1000")
        parts = []
        for source, category, name, model, raw in rows:
            if not model:
                continue
            links = []
            for offer in json.loads(raw).get('offers', []):
                url = offer.get('url', '')
                supplier = _supplier(url)
                if supplier and offer.get('link_kind') == 'supplier_product' and offer.get('variant') == model:
                    links.append({'supplier': supplier, 'url': url, 'source': source})
            if links:
                category = {'motor': 'actuator', 'battery': 'power', 'pump': 'transport', 'power': 'power',
                    'sensor': 'sensor'}.get(category, 'circuit_element')
                parts.append({'id': source.split(':', 1)[1].lower(), 'name': name, 'category': category,
                    'model': model, 'terms': [model, *re.findall(r'\b(?:DFR|FIT|SEN)\d+\b', model)],
                    'purchase_links': links})
        return parts
    finally:
        connection.close()


def offers():
    vetted = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
    # The external snapshot is optional. Reviewed links still work without it.
    try:
        imported = _seed_offers()
    except (OSError, sqlite3.Error, ValueError):
        imported = []
    return [{**part, 'purchase_links': [link for link in part['purchase_links'] if _supplier(link['url'])]}
        for part in (*vetted, *imported)]


def _contains(text, term):
    return bool(re.search(r'(?<![A-Za-z0-9_-])' + re.escape(term) + r'(?![A-Za-z0-9_-])', text, re.I))


def purchase_candidates(text):
    """Only match named models, with explicitly recorded alternatives."""
    matches = []
    for part in offers():
        alternative = part.get('alternative_for')
        exact = any(_contains(text, term) for term in part['terms'])
        if part['purchase_links'] and (exact or alternative and _contains(text, alternative)):
            matches.append({'name': part['name'], 'model': part['model'], 'purchase_links': part['purchase_links'],
                'status': '候选' if exact else '备选', 'note': part.get('note', '')})
    return matches


def purchase_records():
    for part in offers():
        if not part['purchase_links']:
            continue
        detail = {'model': part['model'], 'note': part.get('note', ''), 'alternative_for': part.get('alternative_for')}
        yield SearchRecord(
            ref=RetrievalRef(library_id='procurement', element_id=part['id'], revision=1,
                content_hash=record_hash(part, 'procurement-offer-v1')),
            name=part['name'], category=part['category'],
            search_text=normalize(' '.join((part['name'], part['model'], *part['terms'],
                part.get('alternative_for', ''), part['category']))),
            parameters={}, blockers=('Supplier candidate; no native engineering definition or verified fit.',),
            detail=detail, purchase_links=tuple(PurchaseLink(**link) for link in part['purchase_links']))
