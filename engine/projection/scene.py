def select_frame(ir, result, index=-1):
    if result is None:
        return None
    if result.snapshot_id != ir.snapshot_id:
        raise ValueError("Cannot project results from a different snapshot")
    if not result.frames:
        raise ValueError("Run has no recorded frames")
    return result.frames[index]


def source_ref(ir, obj):
    component = ir.components.get(obj.scope)
    return {"instance_path": list(obj.scope), "definition_id": component.id if component else None,
            "definition_revision": component.revision if component else None,
            "object_id": obj.key.rsplit("/", 1)[-1]}


def project_scene(ir, result=None, frame_index=-1):
    frame = select_frame(ir, result, frame_index)
    bodies = []
    for key, obj in sorted(ir.collection("bodies").items()):
        pose = frame.body_poses.get(key) if frame else None
        bodies.append({"entity_ref": key, "source_ref": source_ref(ir, obj),
                       "world_pose": pose.model_dump(mode="json") if pose else None})
    envelopes = []
    for key, obj in sorted(ir.collection("envelopes").items()):
        envelopes.append({"entity_ref": key, "source_ref": source_ref(ir, obj),
                          "body_ref": "/".join((*obj.scope, "bodies", obj.spec.body_ref)),
                          **obj.spec.model_dump(mode="json", exclude={"body_ref"})})
    joints = [{"entity_ref": key, "parent": j.parent, "child": j.child,
               "kind": j.spec.kind, "axis": j.spec.axis,
               "position_si": frame.joint_positions.get(key) if frame else None}
              for key, j in sorted(ir.joints.items())]
    return {"snapshot_id": ir.snapshot_id, "view": "scene", "time_s": frame.time_s if frame else None,
            "bodies": bodies, "envelopes": envelopes, "joints": joints,
            "visual_assets": [{"entity_ref": key, "source_ref": source_ref(ir, obj),
                               **obj.spec.model_dump(mode="json", exclude={"body_ref"}),
                               "body_ref": "/".join((*obj.scope, "bodies", obj.spec.body_ref))}
                              for key, obj in sorted(ir.collection("visual_assets").items())],
            "collisions": list(frame.collisions) if frame else []}
