"""Sample only declared environment fixtures or previous committed joint state."""

from engine.simulator.logic import sample
from engine.base.signal import channel_key


class SensorScheduler:
    def __init__(self, ir):
        self.sensors = ir.collection("sensors")
        self.counts = {key: 0 for key in self.sensors}
        self.pending = []

    def update(self, ir, state, fixtures, now):
        for key, obj in sorted(self.sensors.items()):
            sensor = obj.spec
            due = self.counts[key] * sensor.sample_period_s
            if due <= now + 1e-12:
                source = sensor.source
                if source.kind == "environment":
                    source_sample = fixtures.get(channel_key(obj.scope, source.channel, fixtures), sample(None, now, "fixture"))
                    reading = source_sample.model_copy(update={"time_s": now})
                else:
                    reading = sample(state.joint_positions.get(ir.resolve(source.joint_ref, obj.scope)), now)
                self.pending.append((now + sensor.latency_s, key, reading))
                self.counts[key] += 1
        remaining = []
        for due, key, reading in sorted(self.pending, key=lambda x: (x[0], x[1])):
            if due <= now + 1e-12:
                state.sensor_samples[key] = reading
            else:
                remaining.append((due, key, reading))
        self.pending = remaining

    def next_time(self):
        times = [self.counts[key] * obj.spec.sample_period_s for key, obj in self.sensors.items()]
        times.extend(t for t, _, _ in self.pending)
        return min(times, default=float("inf"))
