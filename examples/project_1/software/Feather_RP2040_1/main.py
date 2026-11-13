"""Copy this directory to Feather RP2040 running MicroPython; main() is the entry."""
import time
from alarm import AlarmClock, Buttons
from settings import Settings


def main():
    from machine import WDT
    from drivers import Hardware
    hw = Hardware()
    try:
        store = Settings()
        app = AlarmClock(store.value, store.save)
        buttons = Buttons(hw.buttons())
        watchdog = WDT(timeout=4000)
        now, previous, refresh = 0, time.ticks_ms(), -1000
        edit, draft = None, None
        clock_dirty = False
        fields = ('year', 'month', 'day', 'hour', 'minute', 'alarm_hour', 'alarm_minute')
        index = 0
        while True:
            tick = time.ticks_ms()
            now += time.ticks_diff(tick, previous)
            previous = tick
            wall = hw.rtc.read()
            events = buttons.update(hw.buttons(), now)
            consumed = app.tick(wall, now, events)
            hw.sound(app.state == 'RINGING' and now % 1000 < 500)
            # Alarm controls take priority over the editor, with one action per sample.
            if not consumed and app.state == 'IDLE':
                if 'stop' in events and edit:
                    edit, draft = None, None
                elif 'set' in events:
                    if edit is None:
                        current = wall or (2026, 1, 1, 0, 0, 0)
                        draft = dict(zip(fields[:5], current[:5]))
                        draft.update({k: app.settings[k] for k in fields[5:]})
                        edit, index = fields[0], 0
                        clock_dirty = wall is None
                    elif index < len(fields) - 1:
                        index += 1; edit = fields[index]
                    else:
                        # Validate actual month lengths before RTC commit.
                        y, m, d = draft['year'], draft['month'], draft['day']
                        leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
                        days = (31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
                        if d > days[m - 1]: draft['day'] = days[m - 1]; continue
                        if clock_dirty:
                            hw.rtc.set_time((y, m, d, draft['hour'], draft['minute'], 0))
                        app.settings.update({k: draft[k] for k in fields[5:]})
                        app.persist(); app.reschedule()
                        edit, draft = None, None
                elif edit and ('plus' in events or 'minus' in events):
                    limits = {'year': (2000, 2099), 'month': (1, 12), 'day': (1, 31),
                              'hour': (0, 23), 'minute': (0, 59), 'alarm_hour': (0, 23), 'alarm_minute': (0, 59)}
                    lo, hi = limits[edit]
                    draft[edit] = lo + (draft[edit] - lo + (1 if 'plus' in events else -1)) % (hi - lo + 1)
                    if edit in fields[:5]: clock_dirty = True
                elif 'plus' in events:
                    app.settings['enabled'] = not app.settings['enabled']
                    app.persist(); app.reschedule()
                elif 'minus' in events:
                    app.brightness_override = 128 if app.contrast(wall) < 128 else 8
            if now - refresh >= 200:
                refresh = now
                title = '%02d:%02d:%02d' % wall[3:] if wall else 'SET CLOCK / OSF'
                lines = [title, app.state, 'AL %02d:%02d %s' % (app.settings['alarm_hour'],
                    app.settings['alarm_minute'], 'ON' if app.settings['enabled'] else 'OFF')]
                if edit: lines += ['EDIT ' + edit, str(draft[edit]), 'SET next STOP x']
                else: lines += ['SET edit + alarm', '- brightness']
                hw.display.show(lines, app.contrast(wall))
            watchdog.feed()
            time.sleep_ms(5)
    finally:
        hw.close()


if __name__ == '__main__': main()
