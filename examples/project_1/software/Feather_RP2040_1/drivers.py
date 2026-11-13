"""MicroPython adapters for DS3231 and SSD1309 (no SSD1306 charge-pump command)."""
from machine import Pin, SPI, I2C, PWM
import framebuf
import time
from config import RTC, OLED, BUZZER_PIN, BUTTONS


def bcd(value): return (value >> 4) * 10 + (value & 15)
def to_bcd(value): return (value // 10) * 16 + value % 10


class DS3231:
    def __init__(self):
        self.bus = I2C(RTC['i2c'], sda=Pin(RTC['sda']), scl=Pin(RTC['scl']), freq=100000)

    def read(self):
        status = self.bus.readfrom_mem(RTC['address'], 0x0f, 1)[0]
        if status & 0x80: return None  # OSF: time is not trusted.
        r = self.bus.readfrom_mem(RTC['address'], 0, 7)
        hour = bcd(r[2] & 0x1f) % 12 + (12 if r[2] & 0x20 else 0) if r[2] & 0x40 else bcd(r[2] & 0x3f)
        wall = (2000 + bcd(r[6]) + (100 if r[5] & 0x80 else 0), bcd(r[5] & 0x1f),
                bcd(r[4] & 0x3f), hour, bcd(r[1] & 0x7f), bcd(r[0] & 0x7f))
        if not (2000 <= wall[0] <= 2099 and 1 <= wall[1] <= 12 and 1 <= wall[2] <= 31
                and 0 <= wall[3] < 24 and 0 <= wall[4] < 60 and 0 <= wall[5] < 60): return None
        return wall

    def set_time(self, wall):
        y, m, d, h, minute, second = wall
        if not (2000 <= y <= 2099 and 1 <= m <= 12 and 1 <= d <= 31
                and 0 <= h < 24 and 0 <= minute < 60 and 0 <= second < 60):
            raise ValueError('RTC date/time outside supported range')
        self.bus.writeto_mem(RTC['address'], 0, bytes((to_bcd(second), to_bcd(minute), to_bcd(h),
            1, to_bcd(d), to_bcd(m), to_bcd(y - 2000))))
        status = self.bus.readfrom_mem(RTC['address'], 0x0f, 1)[0]
        self.bus.writeto_mem(RTC['address'], 0x0f, bytes((status & 0x7f,)))


class Display:
    def __init__(self):
        self.cs, self.dc, rst = Pin(OLED['cs'], Pin.OUT, value=1), Pin(OLED['dc'], Pin.OUT), Pin(OLED['rst'], Pin.OUT)
        self.spi = SPI(OLED['spi'], baudrate=1000000, polarity=0, phase=0,
                       sck=Pin(OLED['sck']), mosi=Pin(OLED['mosi']))
        rst(0); time.sleep_ms(10); rst(1); time.sleep_ms(100)
        self.buffer = bytearray(1024)
        self.fb = framebuf.FrameBuffer(self.buffer, 128, 64, framebuf.MONO_VLSB)
        for command in (0xfd, 0x12, 0xae, 0xd5, 0xa0, 0xa8, 0x3f, 0xd3, 0, 0x40,
                        0xa1, 0xc8, 0xda, 0x12, 0x81, 0x80, 0xd9, 0x22, 0xdb, 0x34, 0xa4, 0xa6, 0xaf):
            self.command(command)

    def command(self, value):
        self.dc(0); self.cs(0)
        try: self.spi.write(bytes((value,)))
        finally: self.cs(1)

    def show(self, lines, contrast):
        self.fb.fill(0)
        for i, text in enumerate(lines[:6]): self.fb.text(text[:16], 0, i * 10, 1)
        self.command(0x81); self.command(contrast)
        for page in range(8):
            for c in (0xb0 | page, 0x00, 0x10): self.command(c)
            self.dc(1); self.cs(0)
            try: self.spi.write(memoryview(self.buffer)[page * 128:(page + 1) * 128])
            finally: self.cs(1)


class Hardware:
    def __init__(self):
        self.buzzer_pin = Pin(BUZZER_PIN, Pin.OUT, value=0)
        self.pwm = PWM(self.buzzer_pin, freq=4000, duty_u16=0)
        self.keys = {k: Pin(v, Pin.IN, Pin.PULL_UP) for k, v in BUTTONS.items()}
        self.rtc, self.display = DS3231(), Display()

    def buttons(self): return {k: not p.value() for k, p in self.keys.items()}
    def sound(self, on): self.pwm.duty_u16(32768 if on else 0)
    def close(self):
        self.pwm.deinit()
        self.buzzer_pin.init(Pin.OUT, value=0)
