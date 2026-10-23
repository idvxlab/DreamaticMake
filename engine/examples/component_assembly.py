"""Combine typed servo and structural pointer using the existing mount contracts."""
from engine.adapters.commands import move_to
import json
from element.base.quantity import Quantity
from element.base.reference import ObjectRef
from element.categories import Structure
from engine.adapters.assembly import assemble_components
from engine.examples.build_components import examples, ASSUMED
from element.interfaces.geometry import Box
from element.interfaces.mechanical import MechanicalSpec, MechanicalPort
from engine.schema.connections import MechanicalConnection
from engine.schema.assembly import Connections
from engine.schema.scenario import Scenario, RootPlacement
from engine.compiler.lower import compile_model
from engine.simulator.engine import simulate


def example():
    servo = examples()["servo"].replace(mounts=MechanicalSpec(ports={
        "output": MechanicalPort(body_ref="shaft", kind="plane")}))
    pointer = Structure.from_shape(id="example.pointer", name="Passive rigid pointer", structural_role="pointer",
        shape=Box(size_m=(0.10, 0.004, 0.002)), evidence=ASSUMED,
        mounts=MechanicalSpec(ports={"mount": MechanicalPort(body_ref="body", kind="plane")}))
    bundle = assemble_components(id="example.pointer_display", name="Servo pointer display",
        components={"servo": servo, "pointer": pointer}, connections=Connections(mechanical={
            "attachment": MechanicalConnection(
                a=ObjectRef(instance_path=("servo",), collection="mechanical_ports", object_id="output"),
                b=ObjectRef(instance_path=("pointer",), collection="mechanical_ports", object_id="mount"),
                method="fastener", constraint_mode="fixed")}))
    scenario = Scenario(id="pointer_demo", snapshot_id=compile_model(bundle).snapshot_id, duration_s=0.5,
        roots=(RootPlacement(body_ref=ObjectRef(instance_path=("servo",), collection="bodies", object_id="case")),),
        joint_commands=(move_to(servo, Quantity(value=30.0, unit='deg'), instance_path=('servo',)),))
    return bundle, scenario


if __name__ == "__main__":
    bundle, scenario = example()
    run = simulate(compile_model(bundle), scenario)
    print(json.dumps({"status": run.status, "angle_rad": run.frames[-1].joint_positions["servo/joints/axis"]
                      if run.frames else None, "snapshot_id": run.snapshot_id}))
    raise SystemExit(0 if run.status == "completed" else 2)
