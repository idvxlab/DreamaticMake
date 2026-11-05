# Dreamatic Design Engine v2

专注工程设计的独立代码基线。`design-engine-v2` 是从 `design-engine` 的 `5dfde32` 筛选文件后建立的无父提交分支；原分支保留完整应用与历史。

## 对象与设计流程

- [element/](element/README.md)：可复用元件定义、14 类元件、版本化契约、接口、元件库与检索。元件自身的几何、端口、内部运动和行为由这一层持有。
- [engine/](engine/README.md)：选择和组合元件，管理设计方案、实例布局、跨元件连接、编译、投影、仿真与检查。方案通过固定版本引用元件。
- [engine/interface/](engine/interface/README.md)：指定项目文件夹，在项目/元件层级查看结构、运动、电路逻辑及源文件目录与预览。
- [engine/custom_model/](engine/custom_model/README.md)：条件包、命令建模、JSCAD 几何预览及逐零件 STL 导出。
- [examples/](examples/README.md)：迷你机械臂项目案例；元件从统一库或项目自定义目录读取，回归数据归各模块 tests/fixtures。
- [process/](process/README.md)：九个关键设计流程的输入输出、上下文依赖、版本化产物与展示投影；保留七类底层方案操作，直接复用元件及方案对象。

本分支不包含 agent 编排、模型提供商配置、阶段审批、应用服务端或固件流水线。Python 核心与本地界面不需要 API 密钥。

## 安装与运行

Windows 本地环境集中存放在 `.runtime/`，使用仓库内的启动入口：

```powershell
.\npm.cmd run dev
.\python.cmd -m engine schema design_package
```

新克隆需要先安装系统 Node.js 22+、Python 3.11+，再运行 `powershell -ExecutionPolicy Bypass -File scripts/setup-runtime.ps1`。脚本安装本地 npm、创建 Python 环境、安装锁定的前端和 Python 依赖；添加 `-Mesh` 可安装可选碰撞后端。完整目录布局和兼容链接说明见 [RUNTIME.md](RUNTIME.md)。

打开 http://127.0.0.1:4322。启动器和测试脚本优先使用 `MAKE_ENGINE_PYTHON`，其次使用 `.runtime/python`、旧的 `.venv-engine`，最后使用 PATH 中的 `python`。可选 STL 碰撞依赖见 [engine/requirements-mesh.txt](engine/requirements-mesh.txt)。

```sh
.\python.cmd -m element schema element_definition
.\python.cmd -m engine schema design_package
.\python.cmd -m engine project examples/project_1
.\python.cmd -m engine language examples/project_1
```

## 验证

```sh
.\npm.cmd run check
.\npm.cmd test
.\npm.cmd run build
.\npm.cmd run test:ui:standalone-engine
```

`npm test` 运行 TypeScript 定制模型测试，以及 `element/tests`、`engine/tests`、`process/tests` 三套 Python 测试；Python 未安装或依赖缺失会明确失败。可单独运行 `npm run test:python`。浏览器测试需要 Chromium，可通过 `MAKE_TEST_BROWSER` 指定可执行文件；构建产物写入 `engine/interface/dist/`，可用 `npm run preview` 预览。

运行数据、检索索引、本地项目和测试产物均不提交。运行数据位于忽略的 `workspace/`。案例使用合成假设；仿真、几何预览和 STL 导出均不代表物理验证、制造成功或可制造性认证。
