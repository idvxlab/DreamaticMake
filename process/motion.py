"""Explicit cross-element joints, transmissions, drives and inherited initial values."""
import json
from hashlib import sha256
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Id
from element.base.quantity import Quantity
from engine.design.contracts import ObjectRef, Joint, Transmission, Drive, MotionData, Body
from process.contracts import ProcessRequest, ProcessResult
from process.base import DesignProcess, need
from process.proposal import updated_record


class JointInitial(Contract):
    joint_ref: ObjectRef
    value: Quantity


class MotionInput(Contract):
    action: Literal['configure', 'set_configuration', 'solve_target_pose'] = 'configure'
    motion_record_id: Id = 'motion'
    joints: dict[Id, Joint] = Field(default_factory=dict)
    transmissions: dict[Id, Transmission] = Field(default_factory=dict)
    drives: dict[Id, Drive] = Field(default_factory=dict)
    initials: tuple[JointInitial, ...] = ()


class MotionOutput(Contract):
    joint_refs: tuple[ObjectRef, ...] = ()
    transmission_refs: tuple[ObjectRef, ...] = ()
    drive_refs: tuple[ObjectRef, ...] = ()


class MotionRequest(ProcessRequest[MotionInput]):
    process_kind: Literal['motion'] = 'motion'


MotionResult = ProcessResult[MotionOutput]


class MotionProcess(DesignProcess[MotionRequest, MotionResult]):
    kind, title = 'motion', '运动定位与驱动绑定'
    actions = ('configure', 'set_configuration', 'solve_target_pose')
    request_model, result_model, output_model = MotionRequest, MotionResult, MotionOutput

    def _inspect(self, r, ctx, resolved):
        x, items = r.input, []
        if x.action == 'solve_target_pose':
            return [need('solver', 'No inverse kinematics solver is registered', 'executor', 'unsupported')]
        if not (x.joints or x.transmissions or x.drives or x.initials):
            items.append(need('motion', 'Provide joints, transmissions, drives or initial values'))
        if x.motion_record_id not in r.scope.write_record_ids:
            items.append(need('scope', 'Motion record is outside write scope', state='conflict'))
        old = resolved.records.get(x.motion_record_id)
        if old and old.kind != 'motion':
            items.append(need('motion_record_id', 'Record layer mismatch', 'design', 'conflict'))
        objects = dict(resolved.objects)
        objects.update({f'{x.motion_record_id}/joints/{key}': value for key, value in x.joints.items()})
        for joint in x.joints.values():
            if joint.source is not None:
                items.append(need('joints', 'Intrinsic joints may only receive initial-value overrides', state='conflict'))
            for ref in (joint.parent_body, joint.child_body):
                if not isinstance(objects.get(ref.key()), Body):
                    items.append(need('joints', 'Joint body is unavailable', 'design', refs=(ref,)))
            if joint.kind != 'fixed' and (joint.axis is None or joint.initial is None):
                items.append(need('joints', 'Moving joints require an axis and explicit initial value'))
        for transmission in x.transmissions.values():
            if transmission.source is not None:
                items.append(need('transmissions', 'Intrinsic transmission changes require a derived element', state='conflict'))
            for ref in (transmission.driver, transmission.follower):
                if not isinstance(objects.get(ref.key()), Joint):
                    items.append(need('transmissions', 'Transmission joint is unavailable', 'design', refs=(ref,)))
        for drive in x.drives.values():
            if not isinstance(objects.get(drive.joint_ref.key()), Joint):
                items.append(need('drives', 'Drive joint is unavailable', 'design', refs=(drive.joint_ref,)))
        seen = set()
        for initial in x.initials:
            joint = objects.get(initial.joint_ref.key())
            if not isinstance(joint, Joint) or joint.kind == 'fixed':
                items.append(need('initials', 'Initial target is not a moving joint', 'design'))
                continue
            if initial.joint_ref.key() in seen:
                items.append(need('initials', 'Duplicate initial target', state='conflict'))
            seen.add(initial.joint_ref.key())
            if joint.source and initial.joint_ref.record_id != x.motion_record_id and any(
                link['record_id'] in {record.record_id for record in r.base.design.records}
                for link in resolved.reverse.get(initial.joint_ref.key(), ())
            ):
                items.append(need('initials', 'Existing references require an explicit source-address rebinding before creating an override',
                    'design', 'conflict', refs=(initial.joint_ref,)))
            try:
                raw = joint.model_dump(mode='json')
                raw['initial'] = initial.value.model_dump(mode='json')
                Joint.model_validate_json(json.dumps(raw))
            except ValueError:
                items.append(need('initials', 'Initial value has invalid units or exceeds limits', state='conflict'))
            if joint.source is None and initial.joint_ref.record_id != x.motion_record_id:
                items.append(need('initials', 'Author-owned joint requires its own motion record', state='conflict'))
        return items

    def _run(self, r, ctx):
        x = r.input
        old = next((v for v in r.base.design.records if v.record_id == x.motion_record_id), None)
        raw = old.data.model_dump(mode='json') if old else MotionData().model_dump(mode='json')
        for collection in ('joints', 'transmissions', 'drives'):
            raw[collection].update({k: v.model_dump(mode='json') for k, v in getattr(x, collection).items()})
        resolved = ctx.resolve(r.base.design)
        for initial in x.initials:
            joint = x.joints.get(initial.joint_ref.object_id) if initial.joint_ref.record_id == x.motion_record_id else None
            joint = joint or resolved.objects[initial.joint_ref.key()]
            if joint.source:
                existing = next((key for key, val in raw['joints'].items()
                    if val.get('source') == joint.source.model_dump(mode='json')), None)
                key = existing or 'initial_' + sha256(initial.joint_ref.key().encode()).hexdigest()[:20]
                raw['joints'][key] = {'source': joint.source.model_dump(mode='json'),
                    'overrides': {'initial': initial.value.model_dump(mode='json')}}
            else:
                key = initial.joint_ref.object_id
                value = joint.model_dump(mode='json')
                value['initial'] = initial.value.model_dump(mode='json')
                raw['joints'][key] = value
        data = MotionData.model_validate_json(json.dumps(raw))
        refs = lambda collection: tuple(ObjectRef(record_id=x.motion_record_id,
            collection=collection, object_id=key) for key in getattr(data, collection))
        return self.finish(r, ctx, MotionOutput(joint_refs=refs('joints'),
            transmission_refs=refs('transmissions'), drive_refs=refs('drives')),
            changes=(updated_record(r.base.design, x.motion_record_id, 'motion', data),))
