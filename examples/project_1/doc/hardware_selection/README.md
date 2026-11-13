# 03 · 硬件选型

当前元件引用、嵌套实例路径与数量见 selection-v0.5.json / bom-v0.5.json。
v0.4 保留为平铺实例布局的历史记录；采购型号、叶子元件版本与数量没有变化。
五组按键现为机构实例，开关路径例如 `button_stop/switch`，打印件路径例如 `button_stop/cap`。
下文的选型理由与历史实例命名保留作为过程记录；当前工程与数量以 design/、element/ 及 v0.5 记录为准。

版本：`0.3`，2026-11-06。电子方案延续v0.2，新增12种打印定义、25个实例和装配辅料；当前合计38实例。需求v0.4、功能v0.3；采购、打印及样机验证待完成。流程：`doc/tasks/index.json`。

## 本轮选择

采用 USB-C 外接供电＋受保护单节锂电池整机备用。Feather RP2040 集成充电与 USB/电池自动切换，显示和 RTC 都从维持供电的 3.3V 轨取电；无须把 RTC 小电池当作整机电源。自动切换能力来自 [Feather 官方电源说明](https://learn.adafruit.com/adafruit-feather-rp2040-pico/power-management)，本项目尚未实测切换。

用户明确体积优先、不限定时长，本轮选 [Adafruit 3898 400mAh 保护电池](https://www.adafruit.com/product/3898)，不增加大电池去满足未提出的整夜目标。保护板和原装 JST-PH 极性保留，收货时核对；电池图纸最大包络约 37 × 17.5 × 8.2 mm，不含接线与连接器空间。[电池图纸](https://cdn-shop.adafruit.com/product-files/3898/3898_specsheet_LP801735_400mAh_3.7V_20161129.pdf)

| 实例 ID | 选型 / 数量 | 来源与版本 | 选择依据 / 未知项 |
| --- | --- | --- | --- |
| controller | Adafruit Feather RP2040，PID 4884 ×1 | 自定义原生定义，revision 3 | 增加项目GPIO模式契约，不是已执行固件配置 |
| display | Waveshare 2.42inch OLED Module (C)，黄色、SSD1309 ×1 | 自定义，revision 2 | 128×64，SPI；显示时分、图标和夜间调暗；电流及厚度未知 |
| rtc | Adafruit DS3231 STEMMA QT，PID 5188 ×1 | 自定义，revision 3 | I2C、VBAT接主保护电池；整板耗电需测 |
| battery | Adafruit 3898，1S 3.7V 400mAh 保护电池 ×1 | 自定义，revision 2 | 体积优先；不承诺固定时长 |
| buzzer | Adafruit PS1240，PID 160 无源压电器 ×1 | 自定义，revision 2 | 支持微控制器方波驱动；壳内声压未知 |
| button_snooze / stop / set / minus / plus | C&K PTS645SL43-2 LFS ×5 | 共用 button_pts645 自定义定义，revision 1 | 固定到完整 THT 料号、4.3mm 高度；外部键帽和安装小板后续设计 |
| buzzer_r1 / buzzer_r2 | 220Ω 电阻 ×2 | 本地固定快照，同一 revision 1 | 来自 resistor_220ohm，两只共用一份引用；拟串联用于压电驱动 |
| usb_input | 外部 USB 5V / 至少 1A 供电接口规格 ×1 | 自定义接口契约，revision 1 | **不是已锁定适配器产品**；适配器和 A→C 电缆采购型号待定，不安装在壳内 |

主控外廓约51×23×7.5mm，来自 [4884产品页](https://www.adafruit.com/product/4884)。RTC采用 [5188模块](https://www.adafruit.com/product/5188)，不安装CR1220。v0.2改为VIN接3.3V、VBAT接主保护电池；VBAT不再闲置接地，纽扣电池座不得再装电池。主电池耗尽后校验时间有效性。[DS3231手册](https://www.analog.com/media/en/technical-documentation/data-sheets/ds3231.pdf)

## 元件库实际检查

已只读检查指定 D 盘库及其准入记录，未修改库内容。候选与固定引用见 [来源记录](sources-v0.1.json)。

| 候选 | 结果 | 原因 |
| --- | --- | --- |
| resistor_220ohm | 采用 | native_ref 存在且无 blocker，固定哈希，在项目内保存精确固定快照 |
| arduino_uno_r4_wifi | 未选 | 可解析，但板载联网和较大开发板不符合本轮紧凑、独立运行的方案；不会因库件可用而忽略电源切换设计 |
| battery_9v | 未选 | 不是所选单节可充电备用方案，不能直接接 Feather 电池口 |
| template_oled / template_usb_supply | 未选 | synthetic_template，只是模拟模板，不能当成可采购模块及实际备用电源 |
| lcd_1602 | 不直接引用 | incomplete；几何型号、字符/像素定义及电流等存在 blocker |
| pushbutton_6mm | 不直接引用 | incomplete；原记录未锁完整料号和采样策略 |
| piezo_passive | 不直接引用 | incomplete；型号一致性及几何资产不足 |

按键采用新原生定义，明确完整料号；原生契约要求的 1ms 采样属于**本项目夹具策略假设**，不是机械开关性能，未伪造消抖或实测。外形只有本体包络，未复用型号不符的 CAD，也未清除上游 blocker。按键料号编码及 THT 图纸见 [C&K 原厂手册](https://www.ckswitches.com/media/1471/pts645.pdf)；当前手册的订货编码与部分性能表有不一致，操作力和实际引脚配对保留待核对，不据此声明触感或寿命达标。

## 接口与需求覆盖

| 需求 | 选型覆盖 | 进入下一步前需保留的限制 |
| --- | --- | --- |
| R-02/06/07 | OLED 时分、状态及 SSD1309 对比度控制 | 最暗亮度、视距、字高和功耗尚未实测 |
| R-03/05/09 | 五个实体开关＋独立键帽区域 | 接点对照、消抖、键帽导向、误按和单手稳定性待检查 |
| R-04 | RTC＋主控调度＋压电器 | 无已编译控制程序，无壳内声压证据 |
| R-08/12 | Feather 自动切换＋400mAh 电池，全部核心负载在 3.3V 轨 | 实际切换扰动、欠压、温升及续航待测试 |
| R-01/11 | 所选模块尺寸小于概念主壳各方向尺寸 | 仅单件比较，不代表整体已经排布或装得下 |

SPI 显示占用时钟、数据、片选、D/C、复位共 5 个信号；RTC 占 I2C 2 个信号；按键 5 个输入；压电 1 个 PWM 输出，共 13 个信号。Feather 外引 21 个 GPIO，数量有余量；准确 GPIO 分配与 PWM/总线冲突检查在电路逻辑阶段完成，依据 [Feather 引脚说明](https://learn.adafruit.com/adafruit-feather-rp2040-pico/pinouts)。

GPIO 直接连接压电的候选路径为两只 220Ω 串联、另一端接地；拟用约 4kHz 单端方波。3.3V、两只 −5% 电阻时，电阻路径瞬时电流上界估算约 7.9mA；这不证明负载波形或音量达标。压电实际幅度可能因串阻降低，必须测量；不足则改专用驱动并更新选型。器件驱动方式与尺寸依据 [PS1240 官方页](https://www.adafruit.com/product/160)，不采用有 3.3/5V 资料矛盾的 DFR0032 替代。

## 对外观的影响

所选屏幕实际发光区 **55.01×27.49 mm**，模块 **61.5×39.5 mm**，来自 [Waveshare 产品规格](https://www.waveshare.com/2.42inch-oled-module.htm)。它不能填满概念图约 100×43 mm 的发光区域。保留圆角横向形态，但前窗应改为围绕实际显示区域设计遮光边框，或后续另选更大屏幕；目前不声称大幅渲染数字能原样实现。模块厚度暂用 5mm 假设，不能据此定壳体。

## 文件与边界

- [selection-v0.3.json](../../../../z_bin/cleanup-2026-11-11/examples/project_2/doc/hardware_selection/selection-v0.3.json)：当前20个选择记录与固定ElementRef、38个实例。
- [bom-v0.3.json](../../../../z_bin/cleanup-2026-11-11/examples/project_2/doc/hardware_selection/bom-v0.3.json)：当前电子/打印件数量、54枚螺钉与载板/软垫规格。
- [baseline-v0.1.json](../../../../z_bin/cleanup-2026-11-11/examples/project_2/doc/hardware_selection/baseline-v0.1.json)：旧元件定义与项目输入快照，旧selection/BOM保留为历史。
- [power-budget.md](power-budget.md)：电源路径、预算假设与验证计划。
- [validation-v0.3.json](../../../../z_bin/cleanup-2026-11-11/examples/project_2/doc/hardware_selection/validation-v0.3.json)：当前原生引用、BOM及CAD交付复核；v0.1/v0.2检查保留为旧快照。

自定义包均为 `manifest.json + element.json`。主控与RTC当前revision 2，其余自定义定义仍为revision 1，电阻库引用未变。显示文字和音调是静态初值，不是已实现程序。改接口或几何须增版并同步BOM与引用。

当前是电子方案 BOM，价格为未知，不报零价或虚构总价。适配器/电缆采购、安装小板、键帽、紧固件和壳体仍待后续确定；不把本表称作可直接制造的完整物料表。

当前位姿及装配树随CAD更新，见第06—09步；旧v0.1/v0.2检查仅绑定对应快照。已运行打印件实体CAD和STEP重读，没有固件编译、充放电、打印或制造证据。
