"""Real STL/FCL regressions. Optional mesh stack is deliberately not core-required."""
import base64
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from engine.base.frame import Pose
from engine.compiler.lower import compile_model
from engine.examples.build_examples import parse, quantity, ref
from engine.interface.geometry import TriangleMesh
from engine.io.mesh import inspect_stl, load_stl, resolve_stl
from engine.io.mesh_bundle import mesh_bundle
from engine.schema.assembly import ModelBundle
from engine.schema.scenario import Scenario
from engine.simulator.engine import simulate
from engine.simulator.mesh_collision import MeshCollisionWorld
from engine.tests.helpers import single

AVAILABLE = all(importlib.util.find_spec(m) for m in ("trimesh", "fcl", "rtree"))


@unittest.skipUnless(AVAILABLE, "Install engine/requirements-mesh.txt")
class MeshTests(unittest.TestCase):
    def setUp(self):
        import trimesh
        self.trimesh = trimesh
        self.data = trimesh.creation.box(extents=[20, 20, 20]).export(file_type="stl")
        self.assets = {}

    def shape(self, data=None, mode="surface", unit="mm"):
        data = self.data if data is None else data
        digest = hashlib.sha256(data).hexdigest()
        self.assets[digest] = data
        return {"kind": "triangle_mesh", "unit": unit, "collision_mode": mode,
                "asset_ref": {"artifact_id": "00000000-0000-4000-8000-000000000001",
                              "sha256": digest, "media_type": "model/stl"}}

    def world(self, a, b, **envelope_options):
        ir, _ = single({"physical": {"geometry": {"root_body": "a",
            "bodies": {"a": {}, "b": {}},
            "envelopes": {"a": {"body_ref": "a", "shape": a, **envelope_options},
                          "b": {"body_ref": "b", "shape": b}}}}})
        return MeshCollisionWorld(ir, lambda ref: self.assets[ref.sha256])

    def hits(self, world, x=0.0, y=0.0, rotation=(0.0, 0.0, 0.0, 1.0)):
        return world.query({"bodies/a": Pose(),
            "bodies/b": Pose(translation_m=(x, y, 0.0), rotation_xyzw=rotation)})

    def test_binary_ascii_and_units_preserve_coordinates(self):
        box = self.trimesh.creation.box(extents=[20, 20, 20])
        box.apply_translation([30, 0, 0])
        for file_type in ("stl", "stl_ascii"):
            data = box.export(file_type=file_type)
            data = data.encode("ascii") if isinstance(data, str) else data
            info = inspect_stl(data, "mm")
            self.assertEqual(info["triangles"], 12)
            self.assertTrue(info["volume_candidate"])
            self.assertAlmostEqual(info["bounds_m"][0][0], 0.02)
            self.assertAlmostEqual(inspect_stl(data, "cm")["bounds_m"][1][0], 0.4)

    def test_malformed_nonfinite_degenerate_and_budgets(self):
        for data in (b"", b"not stl", self.data[:-1], b"x" * 5_000_001):
            with self.assertRaises(ValueError):
                load_stl(data, "mm")
        for value in (float("nan"), float("inf")):
            data = bytearray(self.data)
            struct.pack_into("<f", data, 96, value)
            with self.assertRaises(ValueError):
                load_stl(bytes(data), "mm")
        data = bytearray(self.data)
        data[96:132] = bytes(36)
        with self.assertRaises(ValueError):
            load_stl(bytes(data), "mm")
        with self.assertRaises(ValueError):
            load_stl(self.data, "inch")

    def test_explicit_asset_resolution_and_hash(self):
        shape = parse(TriangleMesh, self.shape())
        with self.assertRaisesRegex(ValueError, "explicit asset resolver"):
            resolve_stl(shape, None)
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            resolve_stl(shape, lambda _: self.data + b"x")
        self.assertTrue(resolve_stl(shape, lambda _: self.data).is_volume)

    def test_surface_overlap_separation_touch_and_rotation(self):
        world = self.world(self.shape(), self.shape())
        self.assertTrue(self.hits(world, x=0.015))
        self.assertTrue(self.hits(world, x=0.020))
        self.assertFalse(self.hits(world, x=0.021))
        rotation = (0.0, 0.0, math.sin(math.pi / 8), math.cos(math.pi / 8))
        self.assertTrue(self.hits(world, x=0.023, rotation=rotation))
        self.assertFalse(self.hits(world, x=0.025, rotation=rotation))

    def test_solid_containment_is_explicit(self):
        inner = self.trimesh.creation.box(extents=[2, 2, 2]).export(file_type="stl")
        self.assertFalse(self.hits(self.world(self.shape(), self.shape(inner))))
        self.assertTrue(self.hits(self.world(self.shape(mode="solid"), self.shape(inner))))
        # Both orderings, including a native primitive containing a mesh.
        sphere = {"kind": "sphere", "radius_m": 0.001}
        self.assertFalse(self.hits(self.world(self.shape(), sphere)))
        self.assertTrue(self.hits(self.world(self.shape(mode="solid"), sphere)))
        self.assertTrue(self.hits(self.world({"kind": "sphere", "radius_m": 0.1}, self.shape())))

    def test_open_mesh_is_surface_only(self):
        box = self.trimesh.creation.box()
        box.update_faces(list(range(10)))
        data = box.export(file_type="stl")
        self.assertFalse(inspect_stl(data, "m")["volume_candidate"])
        self.world(self.shape(data), self.shape())
        with self.assertRaisesRegex(ValueError, "Solid mode"):
            self.world(self.shape(data, mode="solid"), self.shape())

    def test_concave_cavity_not_convex_hull(self):
        # A torus has an empty center even though its convex hull does not.
        torus = self.trimesh.creation.torus(major_radius=0.03, minor_radius=0.005)
        shape = self.shape(torus.export(file_type="stl"), mode="solid", unit="m")
        world = self.world(shape, {"kind": "sphere", "radius_m": 0.002})
        self.assertFalse(self.hits(world))
        self.assertTrue(self.hits(world, x=0.03))
        self.assertFalse(self.hits(world, x=0.04))

    def test_all_disconnected_components_participate_in_containment(self):
        a = self.trimesh.creation.box(extents=[2, 2, 2])
        a.apply_translation([100, 0, 0])
        b = self.trimesh.creation.box(extents=[2, 2, 2])
        disconnected = self.trimesh.util.concatenate([a, b]).export(file_type="stl")
        self.assertTrue(self.hits(self.world(self.shape(mode="solid"), self.shape(disconnected))))

    def test_native_cylinder_capsule_and_envelope_pose_margin(self):
        for shape in ({"kind": "cylinder", "radius_m": 0.002, "length_m": 0.02},
                      {"kind": "capsule", "radius_m": 0.002, "segment_length_m": 0.02}):
            world = self.world(self.shape(), shape)
            self.assertTrue(self.hits(world, x=0.011))
            self.assertFalse(self.hits(world, x=0.013))
        world = self.world(self.shape(), self.shape(), margin_m=0.002,
                           pose={"translation_m": [0.01, 0, 0]})
        self.assertTrue(self.hits(world, x=0.031))
        self.assertFalse(self.hits(world, x=0.033))

    def test_same_body_envelopes_are_excluded(self):
        shape = self.shape()
        ir, _ = single({"physical": {"geometry": {"root_body": "a", "bodies": {"a": {}},
            "envelopes": {f"mesh_{i}": {"body_ref": "a", "shape": shape} for i in range(2)}}}})
        world = MeshCollisionWorld(ir, lambda ref: self.assets[ref.sha256])
        self.assertFalse(world.query({"bodies/a": Pose()}))

    def test_full_simulation_and_missing_assets(self):
        docs = mesh_bundle([{"id": name, "shape": self.shape(mode="solid")}
                            for name in ("a", "b")])
        ir = compile_model(parse(ModelBundle, docs["bundle"]))
        scenario = parse(Scenario, docs["scenario"])
        result = simulate(ir, scenario, asset_resolver=lambda ref: self.assets[ref.sha256])
        self.assertEqual(result.status, "completed")
        self.assertTrue(result.frames[0].collisions)
        self.assertEqual(simulate(ir, scenario).status, "failed")
        options = scenario.solver_options.model_copy(update={"collision": False})
        self.assertEqual(simulate(ir, scenario.model_copy(update={"solver_options": options})).status, "completed")

    def test_missing_optional_dependency_is_unsupported(self):
        docs = mesh_bundle([{"id": "a", "shape": self.shape()}])
        ir = compile_model(parse(ModelBundle, docs["bundle"]))
        with patch.dict(sys.modules, {"fcl": None}):
            result = simulate(ir, parse(Scenario, docs["scenario"]))
        self.assertEqual(result.status, "unsupported")
        self.assertEqual(result.frames, ())
        self.assertIn("collision.dependency", [d.code for d in result.diagnostics])

    def test_moving_joint_updates_mesh_collision_frames(self):
        shape = self.shape(mode="solid")
        ir, scenario = single({"physical": {
            "geometry": {"root_body": "base", "bodies": {"base": {}, "moving": {}},
                "envelopes": {name: {"body_ref": name, "shape": shape} for name in ("base", "moving")}},
            "motion": {"joints": {"slide": {"kind": "prismatic", "parent_body": ref("bodies", "base"),
                "child_body": ref("bodies", "moving"), "axis": [1, 0, 0],
                "initial_position": quantity(0, "m"), "drive_mode": "velocity",
                "position_limit": {"min": quantity(0, "m"), "max": quantity(0.1, "m")},
                "velocity_limit": quantity(1, "m/s")}}}}},
            {"roots": [{"body_ref": ref("bodies", "base")}], "duration_s": 0.1,
             "joint_commands": [{"time_s": 0, "target": ref("joints", "slide"), "mode": "velocity",
                                 "value": quantity(0.4, "m/s")}]})
        result = simulate(ir, scenario, asset_resolver=lambda r: self.assets[r.sha256])
        self.assertEqual(result.status, "completed")
        self.assertTrue(result.frames[0].collisions)
        self.assertFalse(result.frames[-1].collisions)
        self.assertAlmostEqual(result.frames[-1].body_poses["bodies/moving"].translation_m[0], 0.04)

    def test_cli_import_and_inline_request(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "sample.stl"
            path.write_bytes(self.data)
            run = subprocess.run([sys.executable, "-B", "-m", "engine", "import-stl", str(path), "--unit", "mm"],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            imported = json.loads(run.stdout)
            model = Path(folder) / "bundle.json"
            model.write_text(json.dumps(imported["bundle"]), encoding="utf-8")
            run = subprocess.run([sys.executable, "-B", "-m", "engine", "validate", str(model), "--asset-root", folder],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        docs = mesh_bundle([{"id": "a", "shape": self.shape()}])
        request = {"request_id": "mesh-test", "method": "workspace", **docs,
                   "assets": {k: base64.b64encode(v).decode("ascii") for k, v in self.assets.items()}}
        run = subprocess.run([sys.executable, "-B", "-m", "engine", "request"],
                             input=json.dumps(request), capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual(json.loads(run.stdout)["payload"]["result"]["status"], "completed")
