"""Explicit, bounded STL loading. No ambient filesystem or URL resolution."""
from hashlib import sha256
from io import BytesIO
import struct

MAX_STL_BYTES = 5_000_000
MAX_TRIANGLES = 100_000
UNIT_SCALE = {"m": 1.0, "cm": 0.01, "mm": 0.001}


class MeshDependencyError(ValueError):
    pass


def load_stl(data: bytes, unit: str):
    try:
        import numpy as np
        import trimesh
    except ImportError as exc:
        raise MeshDependencyError("Install engine/requirements-mesh.txt for STL support") from exc
    if unit not in UNIT_SCALE:
        raise ValueError("STL unit must be explicitly m, cm or mm")
    if not data or len(data) > MAX_STL_BYTES:
        raise ValueError("STL must be nonempty and at most 5 MB")
    binary = len(data) >= 84 and 84 + 50 * struct.unpack_from("<I", data, 80)[0] == len(data)
    if binary:
        count = struct.unpack_from("<I", data, 80)[0]
    else:
        try:
            text = data.decode("ascii").strip().lower()
        except UnicodeDecodeError as exc:
            raise ValueError("Malformed binary or ASCII STL") from exc
        if not text.startswith("solid") or "endsolid" not in text:
            raise ValueError("Malformed ASCII STL")
        count = text.count("endfacet")
    if not 0 < count <= MAX_TRIANGLES:
        raise ValueError("STL triangle budget exceeded or no triangles")
    try:
        mesh = trimesh.load(BytesIO(data), file_type="stl", force="mesh", process=False)
        if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) != count or not np.isfinite(mesh.vertices).all():
            raise ValueError("Invalid STL vertices or triangle count")
        mesh.vertices *= UNIT_SCALE[unit]
        # Weld STL's duplicated vertices for topology queries, but never fill holes,
        # decimate, take a convex hull, recenter, or silently fix winding.
        mesh.merge_vertices()
        if not len(mesh.faces) or np.any(mesh.area_faces <= 1e-20) or np.max(np.abs(mesh.vertices)) > 1e4:
            raise ValueError("STL contains degenerate faces or exceeds coordinate limits")
        return mesh
    except (ValueError, IndexError, TypeError) as exc:
        raise ValueError(f"Invalid STL: {exc}") from exc


def inspect_stl(data: bytes, unit: str):
    mesh = load_stl(data, unit)
    return {"sha256": sha256(data).hexdigest(), "triangles": len(mesh.faces),
            "vertices": len(mesh.vertices), "bounds_m": mesh.bounds.tolist(),
            "watertight": bool(mesh.is_watertight), "volume_candidate": bool(mesh.is_volume),
            "unit": unit,
            "warnings": [] if mesh.is_volume else ["Mesh is not a consistently wound closed volume; use surface mode"]}


def resolve_stl(shape, resolver):
    if resolver is None:
        raise ValueError("STL assets require an explicit asset resolver")
    if shape.asset_ref.media_type not in ("model/stl", "application/sla", "application/vnd.ms-pki.stl"):
        raise ValueError("Triangle mesh currently requires STL media type")
    data = resolver(shape.asset_ref)
    if not isinstance(data, bytes) or sha256(data).hexdigest() != shape.asset_ref.sha256:
        raise ValueError("STL SHA-256 verification failed")
    mesh = load_stl(data, shape.unit)
    if shape.collision_mode == "solid" and not mesh.is_volume:
        raise ValueError("Solid mode requires a watertight, consistently wound, positive-volume mesh")
    return mesh
