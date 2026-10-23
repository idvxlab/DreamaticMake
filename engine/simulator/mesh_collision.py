"""Optional FCL BVH queries plus closed-volume containment; no contact dynamics."""
from itertools import combinations, product
from element.base.frame import rotate
from element.io.mesh import MeshDependencyError, resolve_stl
from engine.simulator.collision import BASIS


class MeshCollisionWorld:
    def __init__(self, ir, resolver):
        try:
            import numpy as np
            import fcl
            import rtree  # Required by trimesh's point-in-volume queries.
        except ImportError as exc:
            raise MeshDependencyError("Install engine/requirements-mesh.txt for mesh collision (trimesh, python-fcl, rtree)") from exc
        self.np, self.fcl = np, fcl
        self.entries = []
        cache = {}
        total_faces = 0
        for key, obj in sorted(ir.collection("envelopes").items()):
            spec, shape = obj.spec, obj.spec.shape
            mesh, representatives = None, np.zeros((1, 3))
            margin = 0.0
            if shape.kind == "triangle_mesh":
                cache_key = (shape.asset_ref.sha256, shape.unit, shape.collision_mode)
                if cache_key not in cache:
                    mesh = resolve_stl(shape, resolver)
                    geometry = fcl.BVHModel()
                    geometry.beginModel(len(mesh.faces), len(mesh.vertices))
                    geometry.addSubModel(np.asarray(mesh.vertices, dtype=np.float64), np.asarray(mesh.faces, dtype=np.int32))
                    geometry.endModel()
                    # One vertex per connected component suffices after surface-intersection
                    # rejection: components cannot cross a closed boundary undetected.
                    parents = list(range(len(mesh.vertices)))
                    def find(i):
                        while parents[i] != i:
                            parents[i] = parents[parents[i]]
                            i = parents[i]
                        return i
                    for a, b, c in mesh.faces:
                        parents[find(int(b))] = find(int(a))
                        parents[find(int(c))] = find(int(a))
                    indices = sorted({find(int(i)) for i in mesh.faces.flat})
                    if len(indices) > 512:
                        raise ValueError("STL connected-component budget exceeded (512)")
                    cache[cache_key] = mesh, geometry, np.asarray(mesh.vertices[indices])
                mesh, geometry, representatives = cache[cache_key]
                total_faces += len(mesh.faces)
                if total_faces > 300_000:
                    raise ValueError("Expanded mesh triangle budget exceeded (300000)")
                bounds = np.asarray(mesh.bounds)
                margin = spec.margin_m
            elif shape.kind == "box":
                half = np.asarray(shape.size_m) / 2 + spec.margin_m
                geometry = fcl.Box(*(half * 2))
                bounds = np.array([-half, half])
            elif shape.kind == "sphere":
                radius = shape.radius_m + spec.margin_m
                geometry = fcl.Sphere(radius)
                bounds = np.array([[-radius] * 3, [radius] * 3])
            elif shape.kind in ("cylinder", "capsule"):
                radius = shape.radius_m + spec.margin_m
                length = shape.length_m + 2 * spec.margin_m if shape.kind == "cylinder" else shape.segment_length_m
                geometry = (fcl.Cylinder if shape.kind == "cylinder" else fcl.Capsule)(radius, length)
                half_z = length / 2 + (radius if shape.kind == "capsule" else 0)
                bounds = np.array([[-radius, -radius, -half_z], [radius, radius, half_z]])
            else:
                raise ValueError(f"Unsupported FCL shape: {shape.kind}")
            corners = np.array(list(product(*zip(bounds[0], bounds[1]))))
            self.entries.append({"key": key, "body": "/".join((*obj.scope, "bodies", spec.body_ref)),
                "spec": spec, "mesh": mesh, "representatives": representatives,
                "object": fcl.CollisionObject(geometry), "corners": corners, "margin": margin})

    def contains(self, entry, points_world):
        np, spec = self.np, entry["spec"]
        shape = spec.shape
        points = (points_world - entry["translation"]) @ entry["rotation"]
        if shape.kind == "triangle_mesh":
            return shape.collision_mode == "solid" and bool(entry["mesh"].contains(points).any())
        if shape.kind == "box":
            return bool(np.all(np.abs(points) <= np.asarray(shape.size_m) / 2 + spec.margin_m, axis=1).any())
        radius = shape.radius_m + spec.margin_m
        if shape.kind == "sphere":
            return bool((np.sum(points ** 2, axis=1) <= radius ** 2).any())
        if shape.kind == "cylinder":
            return bool(((np.sum(points[:, :2] ** 2, axis=1) <= radius ** 2) &
                         (np.abs(points[:, 2]) <= shape.length_m / 2 + spec.margin_m)).any())
        delta = points.copy()
        delta[:, 2] -= np.clip(points[:, 2], -shape.segment_length_m / 2, shape.segment_length_m / 2)
        return bool((np.sum(delta ** 2, axis=1) <= radius ** 2).any())

    def query(self, poses):
        np, fcl = self.np, self.fcl
        for entry in self.entries:
            placement = poses[entry["body"]].compose(entry["spec"].pose)
            rotation = np.asarray([rotate(placement.rotation_xyzw, a) for a in BASIS]).T
            translation = np.asarray(placement.translation_m)
            entry["rotation"], entry["translation"] = rotation, translation
            entry["object"].setTransform(fcl.Transform(rotation, translation))
            corners = entry["corners"] @ rotation.T + translation
            entry["bounds"] = corners.min(axis=0) - entry["margin"], corners.max(axis=0) + entry["margin"]
        result = []
        for a, b in combinations(self.entries, 2):
            if a["body"] == b["body"]:
                continue
            if np.any(a["bounds"][0] > b["bounds"][1] + 1e-12) or np.any(b["bounds"][0] > a["bounds"][1] + 1e-12):
                continue
            hit = fcl.collide(a["object"], b["object"], fcl.CollisionRequest(), fcl.CollisionResult()) > 0
            margin = a["margin"] + b["margin"]
            if not hit and margin > 0:
                distance = fcl.distance(a["object"], b["object"], fcl.DistanceRequest(), fcl.DistanceResult())
                if not np.isfinite(distance) or distance < 0:
                    raise ValueError("FCL did not produce a valid separation distance")
                hit = distance <= margin + 1e-12
            if not hit:
                hit = self.contains(a, b["representatives"] @ b["rotation"].T + b["translation"]) or \
                      self.contains(b, a["representatives"] @ a["rotation"].T + a["translation"])
            if hit:
                result.append((a["key"], b["key"]))
        return tuple(result)
