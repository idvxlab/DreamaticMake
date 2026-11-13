# Adafruit Feather RP2040 4884

USB-C plus protected 1S LiPo on JST-PH. Manufacturer documents automatic USB/battery switchover. Header subset model: USB data, SWD, and duplicated ground pads are not represented; no switching/charging simulation. Never power backup loads from VBUS. Hardware revision to be checked on receipt. Revision 2 is the project-configured pin-mode contract, not executed firmware. GP18/19 SPI0, GP09/10/11 OLED control, GP02/03 I2C1, GP06/07/12/24/25 pulled-up buttons, GP08 PWM4A. BAT is a passive bidirectional power contact because the native role enum has no bidirectional-power role; it is not a digital signal. No charge/discharge direction simulation.

Native definition: `element.json`, revision 2. No executed firmware or physical validation.
