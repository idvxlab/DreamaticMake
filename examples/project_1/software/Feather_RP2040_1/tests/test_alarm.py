import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from alarm import AlarmClock, Buttons
from config import defaults, SNOOZE_MS, RING_MS
from settings import Settings, crc32


class AlarmTests(unittest.TestCase):
    def app(self):
        values = defaults()
        values['enabled'] = True
        self.saved = []
        return AlarmClock(values, self.saved.append)

    def ring(self, app):
        app.tick((2026, 11, 7, 6, 59, 59), 0)
        app.tick((2026, 11, 7, 7, 0, 0), 1000)
        self.assertEqual(app.state, 'RINGING')

    def test_trigger_snooze_stop_and_no_same_day_retrigger(self):
        app = self.app(); self.ring(app)
        self.assertEqual(self.saved[0]['last_day'], 20261107)
        app.tick((2026, 11, 7, 7, 0, 1), 2000, ['snooze'])
        self.assertEqual(app.state, 'SNOOZED')
        app.reschedule()  # Wall-clock changes do not change the monotonic deadline.
        app.tick((2026, 11, 7, 6, 0, 0), 2000 + SNOOZE_MS)
        self.assertEqual(app.state, 'RINGING')
        app.tick((2026, 11, 7, 6, 59, 59), 400000, ['stop', 'set'])
        app.tick((2026, 11, 7, 7, 0, 0), 401000)
        self.assertEqual(app.state, 'IDLE')
        app.tick((2026, 11, 8, 6, 59, 59), 402000)
        app.tick((2026, 11, 8, 7, 0, 0), 403000)
        self.assertEqual(app.state, 'RINGING')

    def test_boot_invalid_time_timeout_and_brightness(self):
        app = self.app()
        app.tick((2026, 11, 7, 7, 0, 0), 0)
        self.assertEqual(app.state, 'IDLE')
        self.ring(app)
        app.tick((2026, 11, 7, 7, 2, 0), 1000 + RING_MS)
        self.assertEqual(app.state, 'IDLE')
        app.tick(None, 200000)
        self.assertEqual(app.previous, None)
        self.assertEqual(app.contrast((2026, 11, 7, 23, 0, 0)), 8)
        app.brightness_override = 128
        self.assertEqual(app.contrast((2026, 11, 7, 23, 1, 0)), 128)
        self.assertEqual(app.contrast((2026, 11, 8, 8, 0, 0)), 128)
        self.assertIsNone(app.brightness_override)

    def test_debounce_and_held_boot_key(self):
        keys = Buttons({'set': True})
        self.assertEqual(keys.update({'set': True}, 100), [])
        keys.update({'set': False}, 101); keys.update({'set': False}, 121)
        keys.update({'set': True}, 130); keys.update({'set': False}, 131)
        keys.update({'set': True}, 132)
        self.assertEqual(keys.update({'set': True}, 151), [])
        self.assertEqual(keys.update({'set': True}, 152), ['set'])

    def test_persistence_and_torn_slot_recovery(self):
        import binascii
        self.assertEqual(crc32(b'123456789'), binascii.crc32(b'123456789'))
        with tempfile.TemporaryDirectory() as tmp:
            store = Settings(tmp)
            value = defaults(); value['enabled'] = True
            store.save(value)
            newer = dict(value, alarm_hour=9)
            store.save(newer)
            self.assertEqual(Settings(tmp).value, newer)
            Path(store.path(store.sequence % 2)).write_text('{torn', encoding='utf-8')
            self.assertEqual(Settings(tmp).value, value)

    def test_persist_failure_prevents_ring(self):
        def fail(value): raise OSError('flash unavailable')
        app = self.app(); app.save = fail
        app.tick((2026, 11, 7, 6, 59, 59), 0)
        with self.assertRaises(OSError): app.tick((2026, 11, 7, 7, 0, 0), 1000)
        self.assertEqual(app.state, 'IDLE')


if __name__ == '__main__': unittest.main()
