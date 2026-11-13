# Feather RP2040 · 床头数字闹钟

软件设计 v0.1，MicroPython RP2，入口 `main.main`。项目主控通过 `design/logic.json.software_projects.controller` 关联本目录，并固定源码清单 hash。元件身份在 `element/index.json` 中固定。
引脚使用 RP2040 的 GP 编号，严格沿用 `doc/logical_layout/pin-plan-v0.1.json`，不混用 Feather D 别名。

| 文件 | 职责 |
| --- | --- |
| `main.py` | 主循环、按键设置界面、显示刷新、看门狗、异常静音 |
| `alarm.py` | 可主机测试的闹铃/贪睡状态机、去抖、昼夜亮度策略 |
| `drivers.py` | SPI0 SSD1309 128×64 显示、I2C1 DS3231、4 kHz PWM、按键 |
| `settings.py` | 两槽设置持久化、CRC 与写后重读；掉电后从有效槽恢复 |
| `config.py` | GPIO、候选时长和默认关闭的闹铃配置 |
| `tests/test_alarm.py` | 不接硬件的行为与存储故障回归 |

## 交互

- 普通界面：`+` 切换闹铃启用；`-` 切换亮/暗档，下次跨昼夜边界恢复自动。
- `SET` 进入并依次切换年、月、日、时、分、闹铃时、闹铃分；`+/-` 改值，最后一次 `SET` 提交；`STOP` 取消。
  仅改闹铃不会重设 RTC。日期超出当月范围时先修正草稿，再按一次 `SET` 确认。
- 响铃：`STOP` 停止当次；`SNOOZE` 延后 5 分钟，最多 3 次；单次响铃最多 2 分钟。
- 22:00–07:00 自动调暗，均为现有需求中的候选参数，可在 `config.py` 调整。

启动不补响当前分钟；只能在观察到的闹铃分钟边界触发。持久化日期水位避免同一天回调时钟或重启重复响铃；
主动把日期回调到水位之前会抑制闹铃，直到日期超过该水位，维护时需明确处理该策略。
贪睡和响铃计时使用经过时间，不受校时影响。RTC 的 OSF 置位、读失败或程序异常时不宣称时间有效；
异常退出通过 finally 停止 PWM。设置保存失败不开始新响铃。
RTC 未校准时显示 `SET CLOCK / OSF`，可通过设置界面完整校时。

## 运行与验证

主机测试（仓库根）：

```powershell
.\python.cmd -B -m unittest discover -s examples/project_2/software/Feather_RP2040_1/tests -v
```

`npm test` 也包含此测试。若本机默认临时目录受限，使用仓库的测试入口。
确认实物模块/线序后，将本目录的五个运行 `.py` 文件复制到 Feather RP2040 的 MicroPython 文件系统根目录。
上电运行 `main.py`。没有第三方 Python 包依赖；硬件端依赖 MicroPython 内置 `machine`、`framebuf` 等模块。
主机测试不能代替目标板部署。板上生成的 `clock-settings-*.json` 是运行数据，不提交到项目源代码。

实现依据：[MicroPython RP2](https://docs.micropython.org/en/v1.26.0/rp2/quickref.html)、
[DS3231 数据手册](https://www.analog.com/media/en/technical-documentation/data-sheets/ds3231.pdf)、
[SSD1309 Rev 1.1](https://files.waveshare.com/wiki/2.42inch-OLED-Module/SSD1309Datasheet.pdf)。
显示驱动按 SSD1309 的页寻址和外部面板电源编写，没有套用 SSD1306 充电泵初始化。

已实现源代码及主机回归；未在 MicroPython 解释器或真实 Feather 上执行、烧录或做电气验证。
显示方向、面板初始化/亮度、RTC 精度、按键弹跳、PWM 输出强度与声压、备用电池切换和续航仍待台架验证。
