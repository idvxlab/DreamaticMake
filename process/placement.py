"""Explicit world/body-relative placement; no automatic layout solver."""
import json
from typing import Literal
from pydantic import Field
from element.base.contract import Contract
from element.base.frame import Pose
from engine.design.contracts import ObjectRef, Body, SelectionData
from process.contracts import ProcessRequest, ProcessResult
from process.base import DesignProcess, need
from process.proposal import updated_record


class PlacementTarget(Contract):
    instance_ref: ObjectRef
    pose: Pose
    relative_to_body: ObjectRef | None = None


class PlacementInput(Contract):
    mode: Literal['set_pose', 'suggest_layout'] = 'set_pose'
    poses: tuple[PlacementTarget, ...] = Field(default=(), max_length=1000)
    fixed_instance_refs: tuple[ObjectRef, ...] = ()


class PlacedInstance(Contract):
    instance_ref: ObjectRef
    world_pose: Pose


class PlacementOutput(Contract):
    placements: tuple[PlacedInstance, ...]


class PlacementRequest(ProcessRequest[PlacementInput]):
    process_kind: Literal['placement'] = 'placement'


PlacementResult = ProcessResult[PlacementOutput]


def world_pose(resolved, ref, seen=()):
    body = resolved.objects.get(ref.key())
    if not isinstance(body, Body) or body.pose is None or ref.key() in seen:
        raise ValueError('Reference frame is unplaced, cyclic, or not a body')
    if body.parent_body:
        return world_pose(resolved, body.parent_body, (*seen, ref.key())).compose(body.pose)
    return body.pose


class PlacementProcess(DesignProcess[PlacementRequest, PlacementResult]):
    kind, title = 'placement', '元件放置'
    actions = ('set_pose', 'suggest_layout')
    request_model, result_model, output_model = PlacementRequest, PlacementResult, PlacementOutput

    def _inspect(self, r, ctx, resolved):
        items, seen = [], set()
        if r.input.mode == 'suggest_layout':
            return [need('solver', 'No automatic layout solver is registered', 'executor', 'unsupported')]
        if not r.input.poses:
            items.append(need('poses', 'Provide explicit instance poses'))
        for target in r.input.poses:
            ref = target.instance_ref
            record = next((v for v in r.base.design.records if v.record_id == ref.record_id), None)
            if ref.collection != 'instances' or ref.key() not in resolved.instance_elements:
                items.append(need('instance_ref', 'Instance or pinned element is unavailable', 'design', refs=(ref,)))
            elif record is None or record.kind != 'selection' or record.data.usage.kind != 'discrete':
                items.append(need('instance_ref', 'Placement currently supports discrete occurrences', 'design'))
            if ref in r.input.fixed_instance_refs or ref.key() in seen:
                items.append(need('poses', 'Locked or duplicate placement target', state='conflict', refs=(ref,)))
            seen.add(ref.key())
            if ref.record_id not in r.scope.write_record_ids:
                items.append(need('scope', 'Placement record is outside write scope', state='conflict'))
            for authored in r.base.design.records:
                if authored.kind == 'structure' and any(
                    getattr(b, 'source', None) and b.source.instance_ref == ref
                    and (getattr(b, 'overrides', {}).get('pose') is not None or getattr(b, 'pose', None) is not None)
                    for b in authored.data.bodies.values()
                ):
                    items.append(need('pose', 'Existing body pose override must be reconciled explicitly', 'design', 'conflict'))
            if target.relative_to_body:
                try:
                    world_pose(resolved, target.relative_to_body)
                except ValueError:
                    items.append(need('relative_to_body', 'Reference frame is unavailable', 'design'))
        return items

    def _run(self, r, ctx):
        resolved = ctx.resolve(r.base.design)
        records, placements = {}, []
        for target in r.input.poses:
            ref = target.instance_ref
            pose = world_pose(resolved, target.relative_to_body).compose(target.pose) if target.relative_to_body else target.pose
            raw = records.setdefault(ref.record_id, next(v for v in r.base.design.records if v.record_id == ref.record_id).data.model_dump(mode='json'))
            raw['usage']['instances'][ref.object_id]['pose'] = pose.model_dump(mode='json')
            placements.append(PlacedInstance(instance_ref=ref, world_pose=pose))
        changes = tuple(updated_record(r.base.design, rid, 'selection', SelectionData.model_validate_json(
            json.dumps(raw))) for rid, raw in records.items())
        return self.finish(r, ctx, PlacementOutput(placements=tuple(placements)), changes=changes)
