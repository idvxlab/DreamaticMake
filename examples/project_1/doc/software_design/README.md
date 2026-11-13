# 软件工程设计 v0.1

主控：controller / Adafruit Feather RP2040，当前原生定义 revision 3（v2→v3 契约迁移，采购硬件型号未变）。代码入口：
[`software/Feather_RP2040_1/main.py`](../../software/Feather_RP2040_1/main.py)，工程与交互见[代码说明](../../software/Feather_RP2040_1/README.md)。
关联通过 `design/logic.json.software_projects.controller` 完成，固定目标平台和 source_manifest_hash。旧索引与定义保存在 doc/migration/v2；历史 BOM 保留，新引用见 BOM v0.4。

架构采用可测试的业务状态机 + MicroPython 设备适配；延时操作不使用阻塞等待，
按键、计时、闹铃、显示亮度分别管理。SPI/I2C 初始化和 OLED 帧刷新有少量同步总线耗时，须实测。
设置采用两槽 CRC/读回恢复，报警日期水位在响铃前写入。
需求依据为 requirements/functions v0.3、需求 v0.4 和 GPIO plan v0.1。
迁移后的代码/接线快照与实际主机测试结果见 `verification-v0.2.json`；`verification-v0.1.json` 保留为旧网络格式的历史证据。

验收计划：下一分钟闹铃、停止、三次贪睡、跨日去重、校时、设置取消、夜间亮度、RTC OSF、
保存失败、外接电源拔插和主电池耗尽恢复。主机覆盖行为及存储故障；设备和电气项目仍待实测。
