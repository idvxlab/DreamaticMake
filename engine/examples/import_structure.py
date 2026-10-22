"""Explicit file authoring example; requires engine/requirements-mesh.txt."""
import json
from pathlib import Path
from engine.components import Structure
from engine.compiler.lower import compile_model
from engine.examples.build_components import ASSUMED, scenario_for
from engine.io.load import read_asset
from engine.simulator.engine import simulate


def example():
    root = Path(__file__).parent / "components" / "assets"
    component = Structure.from_stl(id="example.imported_wedge", name="Synthetic imported wedge",
        path=root / "wedge.stl", asset_root=root, unit="mm", collision_mode="solid", evidence=ASSUMED)
    return component, scenario_for(component), root


if __name__ == "__main__":
    component, scenario, root = example()
    run = simulate(compile_model(component), scenario, asset_resolver=lambda ref: read_asset(ref, root))
    print(json.dumps({"design": component.model_dump(mode="json"), "status": run.status,
                      "snapshot_id": run.snapshot_id, "frames": len(run.frames)}, indent=2))
    raise SystemExit(0 if run.status == "completed" else 2)
