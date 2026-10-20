import json
import subprocess
import sys
import unittest
from engine.examples.build_examples import actuator_example, fan_example
from engine.compiler.lower import compile_model
from engine.simulator.engine import simulate
from engine.projection.scene import project_scene
from engine.projection.circuit import project_circuit
from engine.projection.flow import project_flow


class ProjectionAndCliTests(unittest.TestCase):
    def test_workspace_preview_and_run_share_snapshot_and_initial_placement(self):
        from engine.cli import dispatch
        bundle, scenario = actuator_example()
        preview = dispatch("preview", bundle, scenario)
        workspace = dispatch("workspace", bundle, scenario)
        self.assertIsNone(preview["result"])
        self.assertEqual(preview["preview_status"], "completed")
        self.assertEqual(workspace["result"]["status"], "completed")
        self.assertGreater(len(workspace["result"]["frames"]), 1)
        self.assertEqual(preview["scene"]["bodies"], workspace["scene"]["bodies"])
        self.assertEqual(preview["snapshot_id"], workspace["result"]["snapshot_id"])
        self.assertTrue(all(body["world_pose"] is not None for body in preview["scene"]["bodies"]))
        stale = dispatch("preview", bundle, scenario.model_copy(update={"snapshot_id": "0" * 64}))
        self.assertEqual(stale["preview_status"], "failed")
        self.assertTrue(any(d["code"] == "snapshot.stale" for d in stale["diagnostics"]))

    def test_views_share_identity_and_snapshot(self):
        bundle, scenario = actuator_example()
        ir = compile_model(bundle)
        result = simulate(ir, scenario)
        scene = project_scene(ir, result)
        circuit = project_circuit(ir, result)
        self.assertEqual(scene["snapshot_id"], circuit["snapshot_id"])
        self.assertEqual(scene["time_s"], circuit["time_s"])
        self.assertIn("servo/bodies/case", [b["entity_ref"] for b in scene["bodies"]])
        self.assertIn("servo/terminals/vcc", [b["entity_ref"] for b in circuit["terminals"]])
        with self.assertRaises(ValueError):
            project_scene(ir, result.model_copy(update={"snapshot_id": "0" * 64}))

    def test_flow_is_explicitly_topology_only(self):
        bundle, _ = fan_example()
        view = project_flow(compile_model(bundle))
        self.assertEqual(view["mode"], "topology_only")
        self.assertEqual(len(view["paths"]), 1)
        self.assertEqual(len(view["ports"]), 2)

    def test_cli_request_is_single_json_result(self):
        bundle, scenario = actuator_example()
        request = {"request_id": "test-request", "method": "simulate", "bundle": bundle.model_dump(mode="json"),
                   "scenario": scenario.model_dump(mode="json")}
        run = subprocess.run([sys.executable, "-B", "-m", "engine", "request"], input=json.dumps(request),
                             text=True, capture_output=True, timeout=20)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        output = json.loads(run.stdout)
        self.assertEqual(output["request_id"], "test-request")
        self.assertEqual(output["payload"]["status"], "completed")
        self.assertEqual(run.stderr, "")

    def test_cli_invalid_input_is_error_without_traceback(self):
        run = subprocess.run([sys.executable, "-B", "-m", "engine", "request"], input='{"request_id":"a","request_id":"b"}',
                             text=True, capture_output=True, timeout=20)
        self.assertEqual(run.returncode, 2)
        self.assertEqual(json.loads(run.stdout)["type"], "error")
        self.assertNotIn("Traceback", run.stderr)
