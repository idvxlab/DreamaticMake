from engine.io.load import loads
from engine.compiler.resolve import resolve
from engine.projection.scene import source_ref


def project_flow(ir):
    # Connections remain in the frozen input; no second mutable flow graph.
    resolved = resolve(loads(ir.canonical_snapshot))
    connections = []
    for scope, assembly in resolved.assemblies.items():
        for name, connection in assembly.connections.material.items():
            connections.append({"entity_ref": "/".join((*scope, "material_connections", name)),
                                "a": ir.resolve(connection.a, scope), "b": ir.resolve(connection.b, scope)})
    return {"snapshot_id": ir.snapshot_id, "view": "flow", "mode": "topology_only",
            "ports": [{"entity_ref": key, "source_ref": source_ref(ir, obj), **obj.spec.model_dump(mode="json")}
                      for key, obj in sorted(ir.collection("material_ports").items())],
            "paths": [{"entity_ref": key, **obj.spec.model_dump(mode="json"),
                       "inlet_ref": "/".join((*obj.scope, "material_ports", obj.spec.inlet_port)),
                       "outlet_ref": "/".join((*obj.scope, "material_ports", obj.spec.outlet_port))}
                      for key, obj in sorted(ir.collection("material_paths").items())],
            "connections": connections}
