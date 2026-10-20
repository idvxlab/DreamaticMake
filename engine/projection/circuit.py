from engine.projection.scene import select_frame, source_ref


def project_circuit(ir, result=None, frame_index=-1):
    frame = select_frame(ir, result, frame_index)
    return {"snapshot_id": ir.snapshot_id, "view": "circuit", "time_s": frame.time_s if frame else None,
            "terminals": [{"entity_ref": key, "source_ref": source_ref(ir, obj),
                           "net_ref": ir.terminal_nets.get(key), **obj.spec.model_dump(mode="json")}
                          for key, obj in sorted(ir.collection("terminals").items())],
            "nets": [{"entity_ref": key, "members": list(net.members), "kind": net.spec.kind,
                      "sample": frame.network_samples[key].model_dump(mode="json") if frame and key in frame.network_samples else None}
                     for key, net in sorted(ir.nets.items())],
            "behaviors": [{"entity_ref": key, "source_ref": source_ref(ir, obj),
                           "model_id": obj.spec.model_id,
                           "inputs": {name: {**binding.model_dump(mode="json"),
                                             "source_entity_ref": ir.resolve(binding.ref, obj.scope) if binding.ref else None}
                                      for name, binding in obj.spec.inputs.items()},
                           "sample": frame.behavior_outputs[key].model_dump(mode="json") if frame else None}
                          for key, obj in sorted(ir.collection("behaviors").items())]}
