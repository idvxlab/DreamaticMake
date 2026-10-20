from engine.base.signal import Sample, channel_key
from engine.base.reference import ObjectRef
from engine.simulator.electrical import resolve_logic, supply_valid
from engine.simulator.registry import evaluate


def sample(value, now, origin="simulated"):
    quality = "unknown" if value is None or value in ("X", "Z") else "valid"
    return Sample(value=value, time_s=now, quality=quality, origin=origin)


def input_sample(ir, obj, binding, outputs, nets, sensors, fixtures, now):
    if binding.kind == "constant":
        return sample(binding.value, now)
    if binding.kind == "fixture":
        return fixtures.get(channel_key(obj.scope, binding.channel, fixtures), sample(None, now, "fixture"))
    key = ir.resolve(binding.ref, obj.scope)
    if binding.kind == "terminal":
        return nets.get(ir.terminal_nets.get(key), sample(None, now))
    if binding.kind == "sensor":
        return sensors.get(key, sample(None, now))
    return outputs.get(key, sample(None, now))


def settle(ir, state, fixtures, now, max_iterations):
    """Evaluate to a fixed point without repeatedly advancing stateful models."""
    behaviors = ir.collection("behaviors")
    outputs = {key: sample(None, now) for key in behaviors}
    nets = {}
    candidate_states = {}
    wakeups = []
    for _ in range(max_iterations):
        new_nets = {}
        for key, net in sorted(ir.nets.items()):
            if net.spec.kind != "signal":
                continue
            drivers, pulls = [], []
            for member in net.members:
                terminal_obj = ir.objects[member]
                terminal = terminal_obj.spec
                pulls.append(terminal.pull)
                if terminal.drive == "none":
                    continue
                owner = next((bkey for bkey, b in behaviors.items()
                              if b.scope == terminal_obj.scope and member.split("/")[-1] in b.spec.output_terminals), None)
                drivers.append((outputs[owner].value or "X", terminal.drive) if owner else ("Z", terminal.drive))
            new_nets[key] = sample(resolve_logic(drivers, pulls), now)
        new_outputs, candidate_states, wakeups = {}, {}, []
        for key, obj in sorted(behaviors.items()):
            inputs = {name: input_sample(ir, obj, binding, outputs, new_nets, state.sensor_samples, fixtures, now)
                      for name, binding in obj.spec.inputs.items()}
            powered = all(supply_valid(ir, "/".join((*obj.scope, "terminals", terminal))) is True
                          for terminal in obj.spec.supply_terminals)
            if powered:
                value, candidate, wakeup = evaluate(obj.spec, inputs, state.behavior_states.get(key, {}), now)
                new_outputs[key] = sample(value, now)
                candidate_states[key] = candidate
                if wakeup is not None:
                    wakeups.append(wakeup)
            else:
                new_outputs[key] = sample(None, now)
                candidate_states[key] = {}  # Explicit reset-on-invalid-power model.
        if new_outputs == outputs and new_nets == nets:
            return new_outputs, new_nets, candidate_states, wakeups, True
        outputs, nets = new_outputs, new_nets
    return outputs, nets, candidate_states, wakeups, False
