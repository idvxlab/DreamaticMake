import json
import subprocess
import sys
import unittest
from engine.io.design import compose_design
from engine.io.json_schema import export_schema
from engine.cli import dispatch


class DesignAuthoringTests(unittest.TestCase):
    def fixtures(self):
        component = {"record_kind": "component_design", "category": "light", "id": "led", "name": "LED",
                     "channels": {"brightness": {"kind": "constant", "value": 0.5}},
                     "geometry": {"root_body": "body", "bodies": {"body": {}}, "envelopes": {
                         "solid": {"body_ref": "body", "shape": {"kind": "box", "size_m": [0.01, 0.01, 0.01]}}}}}
        design = {"id": "product", "name": "Product", "components": {"led": component}, "input_revisions": {"structure": 1}}
        scenario = {"id": "acceptance", "duration_s": 0.0, "roots": [
            {"body_ref": {"instance_path": ["led"], "collection": "bodies", "object_id": "body"}}]}
        return design, scenario

    def test_compose_pins_hashes_and_executes_function(self):
        design, scenario = self.fixtures()
        documents = compose_design(design, scenario)
        from engine.io.load import loads_model, loads
        from engine.schema.scenario import Scenario
        result = dispatch("workspace", loads_model(json.dumps(documents["bundle"])), loads(json.dumps(documents["scenario"]), Scenario))
        self.assertEqual(result["result"]["status"], "completed")
        self.assertEqual(result["snapshot_id"], documents["scenario"]["snapshot_id"])
        self.assertEqual(result["result"]["frames"][0]["effects"]["led/effects/brightness"]["value"], 0.5)
        self.assertEqual(result["input_revisions"], {"structure": 1})

    def test_request_compose_and_schema(self):
        design, scenario = self.fixtures()
        for request in [{"method": "compose", "design": design, "scenario": scenario},
                        {"method": "schema", "record_kind": "assembly_design"}]:
            run = subprocess.run([sys.executable, "-B", "-m", "engine", "request"],
                input=json.dumps({"request_id": "authoring", **request}), text=True, capture_output=True, timeout=20)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assertEqual(json.loads(run.stdout)["type"], "result")
        self.assertIn("components", export_schema("assembly_design")["properties"])

    def test_authoring_rejects_stale_snapshot_and_executable_fields(self):
        design, scenario = self.fixtures()
        with self.assertRaises(ValueError):
            compose_design(design, {**scenario, "snapshot_id": "0" * 64})
        with self.assertRaises(ValueError):
            compose_design({**design, "script": "print('no')"}, scenario)
        with self.assertRaises(ValueError):
            compose_design({**design, "components": {}}, scenario)
