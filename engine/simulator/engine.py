"""Run a frozen product snapshot without accessing files, models, or the network."""

from math import isfinite
from engine import __version__
from engine.base.diagnostic import Diagnostic, ModelError
from engine.base.quantity import Quantity, UNITS
from engine.base.signal import SignalType, channel_key
from engine.interface.effects import MotionEffect
from engine.io.save import content_hash, canonical_json
from engine.schema.scenario import Scenario
from engine.schema.result import SimulationResult
from engine.compiler.resolve import error
from engine.compiler.validate import warning
from engine.simulator.state import SimulationState
from engine.simulator.registry import check_behavior, input_signal_type
from engine.simulator.logic import sample, settle
from engine.simulator.environment import SensorScheduler
from engine.simulator.kinematics import forward_kinematics, apply_transmissions, advance_positions
from engine.simulator.collision import query_collisions
from engine.simulator.electrical import supply_valid
from engine.simulator.recorder import frame


def typed_value(value, signal_type):
    if value is None:
        return None
    kind = signal_type.kind
    if kind == "scalar":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
            raise ValueError("Scalar fixtures require finite numbers")
        return Quantity(value=value, unit=signal_type.unit).si_value
    if kind == "digital" and value in ("0", "1", "X", "Z"):
        return value
    if kind == "boolean" and isinstance(value, bool):
        return value
    if kind == "event" and isinstance(value, str):
        return value
    raise ValueError(f"Invalid or unsupported fixture value for {kind}")


def compatible(a, b):
    return a.kind == b.kind and (a.kind != "scalar" or UNITS[a.unit][0] == UNITS[b.unit][0])


def preflight(ir, scenario):
    diagnostics = list(ir.diagnostics)
    if scenario.snapshot_id != ir.snapshot_id:
        diagnostics.append(error("snapshot.stale", "Scenario is bound to another snapshot"))
    roots = [ir.resolve(p.body_ref) for p in scenario.roots]
    if len(roots) != len(set(roots)) or set(roots) != set(ir.roots):
        diagnostics.append(error("scenario.roots", "Place each kinematic root exactly once, and no other bodies"))
    if any(not p.anchored for p in scenario.roots):
        diagnostics.append(warning("kinematics.unanchored", "Unanchored roots retain their placement; free-body dynamics is not simulated"))
    for channel in scenario.channels.values():
        try:
            typed_value(channel.initial_value, channel.signal_type)
        except ValueError as exc:
            diagnostics.append(error("fixture.type", str(exc)))
    for event in scenario.stimuli:
        try:
            typed_value(event.value, scenario.channels[event.channel].signal_type)
        except ValueError as exc:
            diagnostics.append(error("fixture.type", str(exc), event.channel))
    for key, joint in ir.joints.items():
        if joint.spec.kind != "fixed" and joint.spec.initial_position is None:
            diagnostics.append(error("joint.initial_unknown", "Simulation requires an explicit initial position", key))
        if joint.spec.drive_mode == "position" and joint.spec.velocity_limit is None:
            diagnostics.append(error("joint.speed_unknown", "Position-controlled motion requires a velocity limit", key))
    driven = {ir.resolve(o.spec.target_joint, o.scope) for o in ir.collection("effects").values() if isinstance(o.spec, MotionEffect)}
    followers = {t.follower for t in ir.transmissions}
    for command in scenario.joint_commands:
        key = ir.resolve(command.target)
        joint = ir.joints.get(key)
        if not joint or key in driven or key in followers or joint.spec.kind == "fixed" or joint.spec.drive_mode != command.mode:
            diagnostics.append(error("command.driver", "Invalid target, mode, or competing joint driver", key))
            continue
        dimension = joint.spec.dimension if command.mode == "position" else ("speed" if joint.spec.dimension == "length" else "angular_speed")
        if command.value.dimension != dimension:
            diagnostics.append(error("command.unit", "Command has incompatible units", key))

    def input_type(binding, scope):
        if binding.kind == "fixture":
            channel = scenario.channels.get(channel_key(scope, binding.channel, scenario.channels))
            return channel.signal_type if channel else None
        if binding.kind == "constant":
            return None
        source = ir.objects[ir.resolve(binding.ref, scope)].spec
        if binding.kind == "terminal":
            return SignalType(kind="digital")
        return source.signal_type if binding.kind == "sensor" else source.output_type

    for key, obj in ir.collection("sensors").items():
        sensor = obj.spec
        if sensor.signal_type.kind not in ("scalar", "digital", "boolean"):
            diagnostics.append(Diagnostic(code="sensor.unsupported", severity="error", outcome="unsupported", message="Only scalar/digital/boolean sensors are simulated", object_refs=(key,)))
        elif sensor.source.kind == "environment":
            channel = scenario.channels.get(channel_key(obj.scope, sensor.source.channel, scenario.channels))
            if channel is None or not compatible(channel.signal_type, sensor.signal_type):
                diagnostics.append(error("sensor.channel", "Sensor channel is missing or incompatible", key))
        else:
            joint = ir.joints.get(ir.resolve(sensor.source.joint_ref, obj.scope))
            if not joint or sensor.signal_type.kind != "scalar" or UNITS[sensor.signal_type.unit][0] != joint.spec.dimension:
                diagnostics.append(error("sensor.joint", "Joint sensor unit is incompatible", key))
    for key, obj in ir.collection("behaviors").items():
        b = obj.spec
        issues = check_behavior(b)
        for issue in issues:
            diagnostics.append(Diagnostic(code="behavior.contract", severity="error", outcome="unsupported", message=issue, object_refs=(key,)))
        if issues:
            continue
        for binding in b.inputs.values():
            if binding.output != "value":
                diagnostics.append(error("behavior.output_ref", "Only the value output is implemented", key))
            if binding.kind == "fixture" and channel_key(obj.scope, binding.channel, scenario.channels) not in scenario.channels:
                diagnostics.append(error("behavior.fixture", "Required fixture channel is missing", key))
        for name, binding in b.inputs.items():
            source_type = input_type(binding, obj.scope)
            expected = input_signal_type(b)
            if source_type and not compatible(source_type, expected):
                diagnostics.append(error("behavior.input_type", "Behavior input has incompatible signal type", key, name))
            if binding.kind == "constant":
                # Numeric binding constants are in SI, not in the output display unit.
                try:
                    validation_type = SignalType(kind="scalar", unit=UNITS[expected.unit][3]) if expected.kind == "scalar" else expected
                    typed_value(binding.value, validation_type)
                except ValueError as exc:
                    diagnostics.append(error("behavior.constant", str(exc), key))
        if b.kind == "state_machine":
            for value in b.states.values():
                try:
                    validation_type = SignalType(kind="scalar", unit=UNITS[b.output_type.unit][3]) if b.output_type.kind == "scalar" else b.output_type
                    typed_value(value, validation_type)
                except ValueError as exc:
                    diagnostics.append(error("behavior.state_value", str(exc), key))
        for terminal in b.supply_terminals:
            terminal_key = "/".join((*obj.scope, "terminals", terminal))
            if supply_valid(ir, terminal_key) is not True:
                diagnostics.append(warning("supply.unavailable", "Invalid or unknown supply; behavior output remains unknown", key, terminal_key))
    if scenario.solver_options.collision:
        envelopes = ir.collection("envelopes")
        mesh_mode = any(o.spec.shape.kind == "triangle_mesh" for o in envelopes.values())
        if len(envelopes) * (len(envelopes) - 1) // 2 > 250000:
            diagnostics.append(error("collision.budget", "Collision pair budget exceeded; narrow the snapshot"))
        represented = {"/".join((*obj.scope, "bodies", obj.spec.body_ref)) for obj in envelopes.values() if obj.spec.purpose == "solid"}
        for body in ir.collection("bodies"):
            if body not in represented:
                diagnostics.append(warning("collision.missing_geometry", "Body has no solid collision envelope", body))
        for key, obj in ir.collection("envelopes").items():
            shape = obj.spec.shape.kind
            if shape not in ("box", "sphere"):
                if mesh_mode and shape in ("triangle_mesh", "cylinder", "capsule"):
                    if shape == "triangle_mesh" and obj.spec.shape.collision_mode == "surface":
                        diagnostics.append(warning("collision.surface_only", "Mesh surface queries do not establish an enclosed solid volume", key))
                elif shape in ("cylinder", "capsule") and scenario.solver_options.conservative_shapes:
                    diagnostics.append(warning("collision.approximation", "Using an explicitly requested outer box", key))
                else:
                    diagnostics.append(Diagnostic(code="collision.unsupported", severity="error", outcome="unsupported", message=f"Collision shape {shape} is not supported in this mode", object_refs=(key,)))
            if obj.spec.approximation != "outer":
                diagnostics.append(warning("collision.geometry", "Envelope is not a verified outer bound", key))
    return diagnostics


def simulate(ir, scenario: Scenario, *, cancelled=None, asset_resolver=None) -> SimulationResult:
    scenario = Scenario.model_validate_json(canonical_json(scenario))
    diagnostics = preflight(ir, scenario)
    frames = []
    coverage = ["tree forward kinematics", "four-state logic", "registered ideal behaviors",
                "sampled fixture/joint sensors", "scalar values use SI units",
                "no dynamics, circuit transient solver, physical validation, or flow solver"]
    mesh_mode = any(o.spec.shape.kind == "triangle_mesh" for o in ir.collection("envelopes").values())
    coverage.append(("sampled FCL triangle-BVH/native primitives + closed-volume containment; no continuous collision guarantee" if mesh_mode else
                     "sampled sphere/OBB collision queries; no continuous collision guarantee") if scenario.solver_options.collision else "collision checks disabled")

    def result(status):
        # Deduplicate recurring diagnostics without discarding object attribution.
        unique = {d.model_dump_json(): d for d in diagnostics}
        return SimulationResult(engine_version=__version__, snapshot_id=ir.snapshot_id,
            scenario_hash=content_hash(scenario), input_revisions=dict(ir.input_revisions), status=status,
            actual_end_s=frames[-1].time_s if frames else 0.0, random_seed=scenario.random_seed,
            coverage=tuple(coverage), diagnostics=tuple(unique.values()), frames=tuple(frames))

    if any(d.severity == "error" for d in diagnostics):
        return result("unsupported" if any(d.outcome == "unsupported" and d.severity == "error" for d in diagnostics) else "failed")
    mesh_world = None
    if mesh_mode and scenario.solver_options.collision:
        from engine.io.mesh import MeshDependencyError
        from engine.simulator.mesh_collision import MeshCollisionWorld
        try:
            mesh_world = MeshCollisionWorld(ir, asset_resolver)
        except MeshDependencyError as exc:
            diagnostics.append(Diagnostic(code="collision.dependency", severity="error", outcome="unsupported", message=str(exc)))
            return result("unsupported")
        except (ValueError, OSError) as exc:
            diagnostics.append(error("collision.mesh_asset", str(exc)))
            return result("failed")
    state = SimulationState()
    state.joint_positions = {key: j.spec.initial_position.si_value for key, j in ir.joints.items() if j.spec.kind != "fixed"}
    before = dict(state.joint_positions)
    apply_transmissions(ir, state.joint_positions)
    if any(abs(state.joint_positions[k] - before[k]) > 1e-9 for k in before):
        diagnostics.append(error("transmission.initial", "Initial joint positions violate transmission constraints"))
        return result("failed")
    state.joint_velocities = {key: 0.0 for key in state.joint_positions}
    roots = {ir.resolve(p.body_ref): p.world_pose for p in scenario.roots}
    fixtures = {key: sample(typed_value(c.initial_value, c.signal_type), 0.0, "fixture", kind=c.signal_type.kind)
                for key, c in scenario.channels.items()}
    stimuli = sorted(scenario.stimuli, key=lambda e: (e.time_s, e.channel))
    commands = sorted(scenario.joint_commands, key=lambda e: (e.time_s, e.target.key()))
    stimulus_index = command_index = 0
    active_commands = {}
    scheduler = SensorScheduler(ir)
    macro_index = 1
    for step in range(scenario.solver_options.max_steps + 1):
        now = state.time_s
        if cancelled and cancelled():
            return result("cancelled")
        while stimulus_index < len(stimuli) and stimuli[stimulus_index].time_s <= now + 1e-12:
            event = stimuli[stimulus_index]
            signal_type = scenario.channels[event.channel].signal_type
            fixtures[event.channel] = sample(typed_value(event.value, signal_type), now, "fixture", kind=signal_type.kind)
            stimulus_index += 1
        while command_index < len(commands) and commands[command_index].time_s <= now + 1e-12:
            event = commands[command_index]
            active_commands[ir.resolve(event.target)] = (event.mode, event.value.si_value)
            command_index += 1
        scheduler.update(ir, state, fixtures, now)
        outputs, nets, next_states, wakeups, converged = settle(ir, state, fixtures, now, scenario.solver_options.logic_iterations)
        if not converged:
            diagnostics.append(error("logic.nonconvergent", "Combinational logic did not reach a fixed point"))
            return result("failed")
        state.behavior_outputs, state.network_samples, state.behavior_states = outputs, nets, next_states
        for key, output in outputs.items():
            if output.quality != "valid":
                diagnostics.append(warning("behavior.unknown_output", "Behavior produced an unknown output; dependent effects are not asserted", key))
        motion_commands = dict(active_commands)
        for key, obj in ir.collection("effects").items():
            bkey = "/".join((*obj.scope, "behaviors", obj.spec.behavior_output_ref.behavior_id))
            output = outputs[bkey]
            state.effects[key] = output
            if isinstance(obj.spec, MotionEffect) and output.quality == "valid":
                motion_commands[ir.resolve(obj.spec.target_joint, obj.scope)] = (obj.spec.mode, output.value)
        try:
            state.body_poses = forward_kinematics(ir, state.joint_positions, roots)
            collisions = (mesh_world.query(state.body_poses) if mesh_world else query_collisions(ir, state.body_poses, scenario.solver_options.conservative_shapes)) if scenario.solver_options.collision else ()
        except (ValueError, OverflowError) as exc:
            diagnostics.append(error("simulation.numeric", str(exc)))
            return result("failed")
        if collisions:
            diagnostics.extend(warning("collision.overlap", f"Envelope overlap at t={now:g}s; physical interference requires geometry review", a, b) for a, b in collisions)
        frames.append(frame(state, collisions))
        if now >= scenario.duration_s - 1e-12:
            return result("completed")
        if step == scenario.solver_options.max_steps:
            diagnostics.append(error("simulation.step_limit", "Simulation exceeded its step budget"))
            return result("failed")
        cells_per_frame = max(1, len(state.body_poses) + len(state.joint_positions) * 2 + len(outputs) + len(nets) + len(state.sensor_samples) + len(state.effects))
        if (len(frames) + 1) * cells_per_frame > 1000000:
            diagnostics.append(error("simulation.record_budget", "Trace cell budget exceeded; reduce duration or recording scope"))
            return result("failed")
        while macro_index * scenario.solver_options.step_s <= now + 1e-12:
            macro_index += 1
        times = [scenario.duration_s, macro_index * scenario.solver_options.step_s, scheduler.next_time(), *wakeups]
        if stimulus_index < len(stimuli):
            times.append(stimuli[stimulus_index].time_s)
        if command_index < len(commands):
            times.append(commands[command_index].time_s)
        future = [t for t in times if t > now + 1e-12]
        if not future:
            diagnostics.append(error("simulation.time", "No advancing simulation time"))
            return result("failed")
        next_time = min(future)
        positions, velocities, violations = advance_positions(ir, state.joint_positions, motion_commands, next_time - now)
        if any(not isfinite(v) for v in (*positions.values(), *velocities.values())):
            diagnostics.append(error("simulation.numeric", "Non-finite motion state"))
            return result("failed")
        for key in violations:
            diagnostics.append(error("joint.limit", f"Motion limit exceeded at t={next_time:g}s", key))
        if violations:
            return result("failed")
        state.joint_positions, state.joint_velocities, state.time_s = positions, velocities, next_time
    return result("failed")
