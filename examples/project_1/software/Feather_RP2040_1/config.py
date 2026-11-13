"""GPIO numbers, not Feather D aliases. Baseline: logical_layout pin-plan v0.1."""
SCHEMA_VERSION = 1
BUTTONS = {'snooze': 6, 'stop': 7, 'set': 12, 'minus': 24, 'plus': 25}
OLED = {'spi': 0, 'sck': 18, 'mosi': 19, 'cs': 9, 'dc': 10, 'rst': 11}
RTC = {'i2c': 1, 'sda': 2, 'scl': 3, 'address': 0x68}
BUZZER_PIN = 8
SNOOZE_MS = 5 * 60 * 1000
MAX_SNOOZES = 3
RING_MS = 2 * 60 * 1000
NIGHT_START = 22
NIGHT_END = 7


def defaults():
    return {'schema_version': 1, 'alarm_hour': 7, 'alarm_minute': 0,
            'enabled': False, 'last_day': 0}
