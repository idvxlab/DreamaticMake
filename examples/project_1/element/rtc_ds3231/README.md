# Adafruit DS3231 STEMMA QT 5188

RTC is a controller/peripheral, not a simulated time source. Powered from maintained 3.3V rail during outage. CR1220 is NOT fitted. Revision 2 uses the protected main LiPo (3.0-4.2V) on VBAT, within its published 2.3-5.5V input range, while VIN is supplied by 3.3V. The coin-cell holder stays empty; no separate cell is connected in parallel. This keeps RTC backup independent of the 3.3V regulator but not of main-pack depletion. After main battery depletion time validity must be checked. Optional coin cell would preserve time only, not run the clock or sound.

Native definition: `element.json`, revision 2. No executed firmware or physical validation.
