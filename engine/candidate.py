"""Small native-v3 semantic candidate builder. Never writes the authoring root."""
import json
import shutil
from pathlib import Path
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Sha256
from element.base.frame import Pose
from element.io.records import record_hash
from engine.design.professional import parse_package, resolved_poses
from engine.project_io import load_design_package
from engine.query import QueryService
from engine.design.authoring import compact_record


class SetPlacement(Contract):
    op: Literal['set_placement'] = 'set_placement'
    target: str
    pose: Pose


class SetJointInitial(Contract):
    op: Literal['set_joint_initial'] = 'set_joint_initial'
    target: str
    position: float


class CandidateProposal(Contract):
    schema_version: Literal['v3-proposal/1'] = 'v3-proposal/1'
    base_snapshot_id: Sha256
    source_manifest_id: Sha256
    operations: tuple[SetPlacement | SetJointInitial, ...] = Field(min_length=1, max_length=20)


def build_candidate(root, destination, proposal, *, write_targets):
    proposal = CandidateProposal.model_validate_json(proposal.model_dump_json() if isinstance(proposal, CandidateProposal) else json.dumps(proposal))
    service = QueryService(root, 'candidate')
    p = service.package
    if p.snapshot_id != proposal.base_snapshot_id or service.source_manifest() != proposal.source_manifest_id:
        raise ValueError('Stale engineering or document baseline')
    targets = [o.target for o in proposal.operations]
    if len(set(targets)) != len(targets) or set(targets) - set(write_targets):
        raise ValueError('Duplicate or out-of-scope write')
    data = p.model_dump(mode='json')
    changed = set()
    for op in proposal.operations:
        if isinstance(op, SetPlacement):
            if op.target not in p.structure.root_placements:
                raise ValueError('Only existing root placement authority can be changed')
            data['structure']['root_placements'][op.target] = op.pose.model_dump(mode='json')
            changed.add('structure')
        else:
            joints = p.effective_joints()
            if op.target not in joints or joints[op.target].type == 'fixed':
                raise ValueError('Only existing moving joints can change initial position')
            data['motion']['initial_positions'][op.target] = op.position
            changed.add('motion')
    for domain in changed:
        record = data[domain]
        record['revision'] += 1
        data['manifest']['record_pins'][domain] = {
            'record_id': record['record_id'], 'revision': record['revision'],
            'content_hash': record_hash(record, 'design-record-v3')}
    candidate = parse_package(data)
    resolved_poses(candidate)  # Complete forest, never a local-only check.
    root, destination = Path(root).resolve(strict=True), Path(destination).resolve()
    workspace = Path(__file__).resolve().parents[1] / 'workspace'
    if not destination.is_relative_to(workspace.resolve()) or destination.exists() or destination.is_relative_to(root):
        raise ValueError('Candidate must be a new directory in managed workspace/')
    # Reject links rather than dereferencing files outside the project.
    for path in root.rglob('*'):
        if path.is_symlink() or path.is_junction(): raise ValueError('Linked project files are unsupported')
    shutil.copytree(root, destination, ignore=shutil.ignore_patterns('.*', '__pycache__', 'node_modules'))
    def save(relative, value):
        target = destination / relative
        target.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    for domain in changed: save(getattr(p.manifest.design, domain), compact_record(getattr(candidate, domain)))
    save('project.json', data['manifest'])
    loaded = load_design_package(destination)
    if loaded.snapshot_id != candidate.snapshot_id: raise ValueError('Candidate round-trip mismatch')
    return {'schema_version': 'candidate-receipt/1', 'base_snapshot_id': p.snapshot_id,
            'candidate_snapshot_id': loaded.snapshot_id, 'write_set': targets,
            'checks': ['native_load', 'complete_forest_fk'],
            'outcome': 'draft', 'missing_checks': ['assembly_collision', 'engineering_acceptance']}
