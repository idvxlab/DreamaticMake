"""Pure alarm state machine. Wall time schedules; monotonic milliseconds time durations."""
from config import SNOOZE_MS, MAX_SNOOZES, RING_MS, NIGHT_START, NIGHT_END


class AlarmClock:
    def __init__(self, settings, save):
        self.settings, self.save = dict(settings), save
        self.state = 'IDLE'
        self.snoozes = 0
        self.deadline = 0
        self.previous = None
        self.night = None
        self.brightness_override = None

    def persist(self):
        self.save(dict(self.settings))  # Save before enabling an externally visible action.

    def reschedule(self):
        # A time edit must not disturb monotonic snooze/ring timers.
        self.previous = None

    def tick(self, wall, now, events=()):
        # wall = (year, month, day, hour, minute, second), or None for invalid RTC.
        consumed = set()
        if 'stop' in events and self.state != 'IDLE':
            self.state = 'IDLE'
            consumed.add('stop')
        elif 'snooze' in events and self.state == 'RINGING':
            consumed.add('snooze')
            if self.snoozes < MAX_SNOOZES:
                self.snoozes += 1
                self.state, self.deadline = 'SNOOZED', now + SNOOZE_MS
            else:
                self.state = 'IDLE'
        if not self.settings['enabled'] or wall is None:
            self.state, self.previous = 'IDLE', None
            return consumed
        if self.state == 'RINGING' and now >= self.deadline:
            self.state = 'IDLE'
        elif self.state == 'SNOOZED' and now >= self.deadline:
            self.state, self.deadline = 'RINGING', now + RING_MS
        day = wall[0] * 10000 + wall[1] * 100 + wall[2]
        minute = wall[3] * 60 + wall[4]
        # Only the observed minute boundary can trigger. No catch-up after boot/time jumps.
        alarm = self.settings['alarm_hour'] * 60 + self.settings['alarm_minute']
        previous = self.previous
        entered = previous is not None and previous[:5] != wall[:5]
        adjacent = previous is not None and ((wall[5] - previous[5]) % 60 in (1, 2))
        expected_previous = (alarm - 1) % 1440
        if (self.state == 'IDLE' and entered and adjacent and wall[5] <= 1 and minute == alarm
                and previous[3] * 60 + previous[4] == expected_previous
                and day > self.settings['last_day'] and not consumed):
            self.settings['last_day'] = day
            self.persist()
            self.state, self.deadline, self.snoozes = 'RINGING', now + RING_MS, 0
        self.previous = wall
        return consumed

    def contrast(self, wall):
        night = wall is not None and (wall[3] >= NIGHT_START or wall[3] < NIGHT_END)
        if night != self.night:
            self.night, self.brightness_override = night, None
        return self.brightness_override if self.brightness_override is not None else (8 if night else 128)


class Buttons:
    """Stable-edge debounce; a held button at startup must first be released."""
    def __init__(self, initial, now=0, delay=20):
        self.raw, self.stable = dict(initial), dict(initial)
        self.changed = {name: now for name in initial}
        self.delay = delay

    def update(self, pressed, now):
        events = []
        for name, value in pressed.items():
            if value != self.raw[name]:
                self.raw[name], self.changed[name] = value, now
            if value != self.stable[name] and now - self.changed[name] >= self.delay:
                self.stable[name] = value
                if value: events.append(name)
        return events
