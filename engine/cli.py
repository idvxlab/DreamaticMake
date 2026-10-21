"""Machine-readable CLI. No shell execution, providers, or implicit file imports."""

import argparse
import json
import sys
import base64
from pathlib import Path
from pydantic import ValidationError
from engine.base.diagnostic import ModelError
from engine.compiler.lower import compile_model
from engine.io.load import load, loads, load_model, loads_model, MAX_BYTES
from engine.io.save import content_hash, canonical_json
from engine.io.json_schema import export_schema
from engine.schema.assembly import ModelBundle
from engine.schema.scenario import Scenario
from engine.simulator.engine import simulate
from engine.projection.scene import project_scene
from engine.projection.circuit import project_circuit
from engine.projection.flow import project_flow


def dispatch(method, bundle, scenario=None, *, asset_resolver=None):
    ir = compile_model(bundle)
    if method in ("validate", "compile"):
        from engine.io.mesh import resolve_stl
        for obj in ir.collection("envelopes").values():
            if obj.spec.shape.kind == "triangle_mesh":
                resolve_stl(obj.spec.shape, asset_resolver)
        return {"snapshot_id": ir.snapshot_id, "input_revisions": dict(ir.input_revisions),
                "bodies": len(ir.collection("bodies")), "joints": len(ir.joints), "nets": len(ir.nets),
                "diagnostics": [d.model_dump(mode="json") for d in ir.diagnostics],
                **({"snapshot": json.loads(ir.canonical_snapshot)} if method == "compile" else {})}
    if method == "simulate":
        if scenario is None:
            raise ValueError("simulate requires a scenario")
        return simulate(ir, scenario, asset_resolver=asset_resolver).model_dump(mode="json")
    if method in ("preview", "workspace"):
        if scenario is None:
            raise ValueError(f"{method} requires a scenario")
        # Preview resolves initial body placement, but never publishes a simulation claim.
        initial = scenario.model_copy(update={"duration_s": 0.0,
            "stimuli": tuple(event for event in scenario.stimuli if event.time_s == 0),
            "joint_commands": tuple(command for command in scenario.joint_commands if command.time_s == 0)})
        run = simulate(ir, initial if method == "preview" else scenario, asset_resolver=asset_resolver)
        frame_run = run if run.frames else None
        return {"snapshot_id": ir.snapshot_id, "input_revisions": dict(ir.input_revisions),
                "diagnostics": [d.model_dump(mode="json") for d in run.diagnostics],
                "scene": project_scene(ir, frame_run, 0), "circuit": project_circuit(ir, frame_run, 0),
                "flow": project_flow(ir), "result": run.model_dump(mode="json") if method == "workspace" else None,
                "preview_status": run.status}
    if method == "scene":
        return project_scene(ir)
    if method == "circuit":
        return project_circuit(ir)
    if method == "flow":
        return project_flow(ir)
    raise ValueError(f"Unknown method: {method}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline product design engine tools")
    parser.add_argument("method", choices=["validate", "compile", "simulate", "scene", "circuit", "flow", "preview", "workspace", "schema", "request", "import-stl"])
    parser.add_argument("input", nargs="?")
    parser.add_argument("--scenario")
    parser.add_argument("--asset-root", help="Explicit confined asset library for relative STL references")
    parser.add_argument("--unit", choices=["m", "cm", "mm"])
    args = parser.parse_args(argv)
    request_id = None
    try:
        if args.method == "schema":
            output = export_schema(args.input or "model_bundle")
        elif args.method == "request":
            # One bounded request per process. Inline snapshots eliminate implicit path access.
            from engine.io.load import _unique, _nonfinite
            text = sys.stdin.buffer.read(MAX_BYTES + 1)
            if len(text) > MAX_BYTES:
                raise ValueError("Request exceeds size limit")
            request = json.loads(text, object_pairs_hook=_unique, parse_constant=_nonfinite)
            if not isinstance(request, dict) or set(request) - {"request_id", "method", "bundle", "scenario", "assets", "data", "unit", "meshes"}:
                raise ValueError("Unexpected request fields")
            request_id = request.get("request_id")
            if not isinstance(request_id, str) or len(request_id) > 128:
                raise ValueError("request_id must be a short string")
            if request["method"] == "inspect_stl":
                from engine.io.mesh import inspect_stl
                payload = inspect_stl(base64.b64decode(request["data"], validate=True), request["unit"])
            elif request["method"] == "mesh_bundle":
                from engine.io.mesh_bundle import mesh_bundle
                payload = mesh_bundle(request["meshes"])
            else:
                assets = request.get("assets", {})
                if not isinstance(assets, dict) or len(assets) > 32:
                    raise ValueError("Invalid inline asset map")
                def resolver(ref):
                    if ref.relative_path is not None:
                        raise ValueError("Request assets must use host-owned Artifact IDs")
                    if ref.sha256 not in assets:
                        raise ValueError("Referenced STL asset was not supplied")
                    return base64.b64decode(assets[ref.sha256], validate=True)
                bundle = loads_model(json.dumps(request["bundle"], allow_nan=False))
                scenario = loads(json.dumps(request["scenario"], allow_nan=False), Scenario) if request.get("scenario") else None
                payload = dispatch(request["method"], bundle, scenario, asset_resolver=resolver)
            output = {"request_id": request_id, "type": "result", "payload": payload}
        elif args.method == "import-stl":
            from engine.io.mesh import inspect_stl, MAX_STL_BYTES
            from engine.io.mesh_bundle import mesh_bundle
            if not args.input or not args.unit:
                raise ValueError("import-stl requires a file and explicit --unit")
            with Path(args.input).open("rb") as stream:
                data = stream.read(MAX_STL_BYTES + 1)
            info = inspect_stl(data, args.unit)
            output = {**mesh_bundle([{"id": "mesh", "shape": {"kind": "triangle_mesh", "unit": args.unit,
                "collision_mode": "surface", "asset_ref": {"relative_path": Path(args.input).name,
                "sha256": info["sha256"], "media_type": "model/stl"}}}]), "inspection": info}
        else:
            if not args.input:
                raise ValueError("A model bundle or component design path is required")
            bundle = load_model(args.input)
            scenario = load(args.scenario, Scenario) if args.scenario else None
            from engine.io.load import read_asset
            resolver = (lambda ref: read_asset(ref, Path(args.asset_root))) if args.asset_root else None
            output = dispatch(args.method, bundle, scenario, asset_resolver=resolver)
        print(json.dumps(output, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
        payload = output.get("payload", output)
        status = (payload.get("result") or {}).get("status", payload.get("status", payload.get("preview_status", "completed")))
        return 0 if status == "completed" else 2
    except (ValueError, TypeError, OSError, KeyError, RecursionError) as exc:
        if isinstance(exc, ModelError):
            details = [d.model_dump(mode="json") for d in exc.diagnostics]
        elif isinstance(exc, ValidationError):
            # Do not echo arbitrary input values or exception context into protocol output.
            details = [{"location": list(e["loc"]), "message": e["msg"], "type": e["type"]}
                       for e in exc.errors(include_input=False, include_context=False)]
        else:
            details = [{"message": str(exc)}]
        print(json.dumps({"request_id": request_id, "type": "error", "diagnostics": details}, ensure_ascii=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
