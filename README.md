# Dreamatic Design Engine v2

## DreamaticMaker v3 application

The application under `apps/` and `packages/` keeps six product agents and runs their conversations through
the local Codex app-server. The application owns task execution; the former standalone `harness/` is retired.
Python stage contracts use the current native engine/element interfaces, including scoped nested-unit references.
Rhino 8 remains the production CAD backend. See [process contracts](process/README.md) for the stage API.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:4322>. The API listens on `127.0.0.1:4323`; project state, contract snapshots and run
events are stored in ignored `workspace/projects/`. A normal stage is:

`pinned inputs → research support (when applicable) → responsible author → output contract validation`.
When the agent needs a design decision, the stage pauses for the user's card answers. Run receipts and
context snapshots are stored under the project's `contracts/runs/` directory.

Only the application approval route can advance a reviewed artifact revision. A rejected artifact can be
resubmitted with the previous artifact, review and next revision injected into the new turn.

专注工程设计的独立代码基线。`design-engine-v2` 是从 `design-engine` 的 `5dfde32` 筛选文件后建立的无父提交分支；原分支保留完整应用与历史。

## 对象与设计流程

- [element/](element/README.md)：可复用元件定义、14 类元件、版本化契约、接口、元件库与检索。元件自身的几何、端口、内部运动和行为由这一层持有。
- [engine/](engine/README.md)：选择和组合元件，管理设计方案、实例布局、跨元件连接、编译、投影、仿真与检查。方案通过固定版本引用元件。
- [engine/interface/](engine/interface/README.md)：指定项目文件夹，在项目/元件层级查看结构、运动、电路逻辑及源文件目录与预览。
- [engine/custom_model/](engine/custom_model/README.md)：条件包、命令建模、JSCAD 几何预览及逐零件 STL 导出。
- [examples/](examples/README.md)：迷你机械臂项目案例；元件从统一库或项目自定义目录读取，回归数据归各模块 tests/fixtures。
- [process/](process/README.md)：九个关键设计流程的输入输出、上下文依赖、版本化产物与展示投影；保留七类底层方案操作，直接复用元件及方案对象。

Python 核心与独立本地界面不需要 API 密钥；v3 应用通过本机 Codex app-server 执行七角色流程。

## 安装与运行

macOS 本地环境集中存放在 `.runtime/`，使用仓库内的启动入口：

```sh
npm run dev
.runtime/python/bin/python -m engine schema design_package
```

新克隆需要先安装系统 Node.js 22+、Python 3.11+，再运行 `./scripts/setup-runtime.sh`。脚本创建 `.runtime/python` 虚拟环境，并安装锁定的前端和 Python 依赖。可选碰撞后端按需从 [engine/requirements-mesh.txt](engine/requirements-mesh.txt) 安装。完整目录布局见 [RUNTIME.md](RUNTIME.md)。

打开 http://127.0.0.1:4322。启动器和测试脚本优先使用 `MAKE_ENGINE_PYTHON`，其次使用 `.runtime/python/bin/python`，最后使用 PATH 中的 `python3`。元件池默认使用仓库内的 `element_pool/`；如需使用本机其他目录，设置 `DREAMATIC_ELEMENT_POOL=/绝对路径`。

```sh
.runtime/python/bin/python -m element schema element_definition
.runtime/python/bin/python -m engine schema design_package
.runtime/python/bin/python -m engine project examples/project_1
.runtime/python/bin/python -m engine language examples/project_1
```

## 验证

```sh
npm run check
npm test
npm run build
npm run test:ui:standalone-engine
```

`npm test` 运行 TypeScript 定制模型测试，以及 `element/tests`、`engine/tests`、`process/tests` 三套 Python 测试；Python 未安装或依赖缺失会明确失败。可单独运行 `npm run test:python`。浏览器测试需要 Chromium，可通过 `MAKE_TEST_BROWSER` 指定可执行文件；构建产物写入 `engine/interface/dist/`，可用 `npm run preview` 预览。

运行数据、检索索引、本地项目和测试产物均不提交。运行数据位于忽略的 `workspace/`。案例使用合成假设；仿真、几何预览和 STL 导出均不代表物理验证、制造成功或可制造性认证。
