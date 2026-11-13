"""Only current-snapshot results may drive overlays."""
def present(result, current_snapshot_id):
    stale = result.evidence['subject_snapshot_id'] != current_snapshot_id
    return {'stale': stale, 'overlay_refs': [] if stale else [
        {'ref': ref, 'finding_id': finding['finding_id']} for finding in result.findings for ref in finding.get('refs', [])],
        'trajectory_ref': None if stale else next((a['id'] for a in result.artifacts if a['kind'] == 'trajectory'), None)}
