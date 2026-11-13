"""Two replaceable slots, read-back verification; CRC detects accidental corruption only."""
import json
import os
from config import defaults


def crc32(data):
    # Portable CRC-32/ISO-HDLC: MicroPython binascii does not guarantee crc32().
    crc = 0xffffffff
    for value in data:
        crc ^= value
        for _ in range(8): crc = (crc >> 1) ^ (0xedb88320 if crc & 1 else 0)
    return crc ^ 0xffffffff


class Settings:
    def __init__(self, folder='.'):
        self.folder, self.sequence = folder, 0
        self.value = defaults()
        candidates = []
        for slot in (0, 1):
            try:
                with open(self.path(slot)) as stream: record = json.load(stream)
                payload = record['payload']
                if crc32(payload.encode()) != record['crc']: continue
                data = json.loads(payload)
                if (data['schema_version'] != 1 or not 0 <= data['alarm_hour'] < 24
                        or not 0 <= data['alarm_minute'] < 60 or type(data['enabled']) is not bool
                        or not isinstance(data['last_day'], int) or data['last_day'] < 0): continue
                candidates.append((record['sequence'], data))
            except (OSError, ValueError, KeyError, TypeError): pass
        if candidates: self.sequence, self.value = max(candidates, key=lambda item: item[0])

    def path(self, slot):
        return self.folder + '/clock-settings-%d.json' % slot

    def save(self, value):
        sequence = self.sequence + 1
        payload = json.dumps(value)
        record = {'sequence': sequence, 'payload': payload, 'crc': crc32(payload.encode())}
        path = self.path(sequence % 2)
        with open(path, 'w') as stream: json.dump(record, stream)
        if hasattr(os, 'sync'): os.sync()
        with open(path) as stream:
            if json.load(stream) != record: raise OSError('Settings read-back failed')
        self.sequence, self.value = sequence, dict(value)
