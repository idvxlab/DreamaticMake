"""Native scope and pair closure. Uncovered/approximate geometry stays explicit."""
from itertools import combinations
from engine.tools.source import collision_entries


def select(source, scope, options):
    entries, missing = collision_entries(source)
    known = {e['ref'] for e in entries} | {e['body'] for e in entries} | {e['owner'] for e in entries} | set(missing)
    if set(scope) - known: raise ValueError('Unknown collision scope')
    if scope:
        entries = [e for e in entries if set(scope) & {e['ref'], e['body'], e['owner']}]
        missing = [r for r in missing if r in scope or r.split('/')[0] in scope]
    by_ref = {e['ref']:e for e in entries}
    pairs = list(options.pairs) if options.pairs else [(a['ref'], b['ref']) for a,b in combinations(entries,2) if a['body'] != b['body']]
    if any(a not in by_ref or b not in by_ref or a == b or by_ref[a]['body'] == by_ref[b]['body'] for a,b in pairs):
        raise ValueError('Pairs require two selected geometries on different bodies')
    omissions = [f'Missing collision geometry: {r}' for r in missing]
    for e in entries:
        if e['geometry']['type'] == 'convex_asset': raise NotImplementedError('Convex asset backend is unavailable')
        if e['approximation'] not in ('outer',): omissions.append(f"Unproven geometry approximation: {e['ref']}")
    return entries, pairs, omissions
