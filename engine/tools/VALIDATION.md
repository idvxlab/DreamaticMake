# 初步适配验证记录

日期：2026-11-09。基线提交：`8d6fa04`（本次工具实现是在其后的工作区修改）。

## 实际执行

- `npm run check`：通过。
- `npm test`：通过；engine suite 178 项，2 项既有环境相关 skip；新增 12 项工具测试全部实际执行并通过。element、process、两个存在的案例软件 suite 与 Node CAD 测试也通过。
- `npm run build`：通过；保留 Vite 的大 chunk 提示（约 756 kB），不影响构建完成。
- `node --import tsx scripts/test-tools-ui.ts`：Edge 无头浏览器通过；实际操作 FK、Sismic simulate、缺少 STEP 输入提示，无 pageerror。本机 HTTP 在受限执行环境中不可访问，该项使用已获准的本机浏览器执行环境运行。

运行使用项目 `.runtime/node`、`.runtime/npm` 和 `.runtime/python`。新增安装 `cadquery-ocp==7.8.1.1.post1` 到项目 Python 环境；FCL 0.7.0.11、Sismic 1.6.11 已存在。

## 几何与执行证据

合成 10×20×30 mm STEP 箱体由真实 OCCT 写入、worker 重新读取：1 solid，valid，体积 `6e-6 m³`，X 包络 `0.01 m`。实际离散化 STL 重读后 Z 尺寸 `0.03 m`；声明单位与 STEP 冲突会拒绝执行。

通过原生 v3 准备 STEP collision，执行 OCCT tessellate → 共用 FCL world。两个 occurrence 复用一个几何缓存条目，来源映射仍保留两个对象；再次运行生成独立 run_id。派生网格缺少已证明外包络误差界，结果保留 unknown。

真实 FCL 测试覆盖分离、重叠、primitive 完全内含、STL solid 内含与 surface 差异、0.1 m 间隙与 0.11 m 阈值、端点安全而中间相交的离散轨迹。还覆盖非恒等 geometry origin、缺失覆盖 unknown、worker 超时与运行中取消。

真实 Sismic 测试覆盖同名同刻事件的稳定处理、可信 send hook 顺序、全图验证、YAML 别名拒绝；project_1 已登记场景实际完成且断言通过。状态图证据不代表固件执行。

## project_2 只读检查

保持原 v2、38 instances，不修改案例。五个 `press/*` 关节同时取各指定位置，使用全项目内部 pair 检查：

| 位置 | execution / outcome | 声明几何重叠 findings | run_id |
| --- | --- | --- | --- |
| 0 mm | completed / fail | 19 | aa162ef9-bad9-4b42-ba1d-f54cf15846f2 |
| 0.2 mm | completed / fail | 23 | ec9d416f-da1c-4a20-81f7-d430df0ca207 |
| 0.4 mm | completed / fail | 23 | bc5f7fac-58ae-493b-8aa4-3256dfc2fcba |

结果同时列明 buzzer_r1/r2 缺少碰撞几何，以及 controller/display/rtc/battery/buzzer/按键等未证明几何近似。上述数量描述声明包络的重叠，不能直接认定为厂家实物干涉。原始记录和工件在忽略目录 `workspace/tools/projects/<项目根摘要>/runs/<run_id>/`。

范围限制见 [README.md](README.md)；多 unit/硬件联合仿真、连续碰撞、STEP 子件选择、完整工作台轨迹播放和旧八层 source adapter 尚未实现。
