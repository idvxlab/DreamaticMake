# Dreamatic Design Engine v2

专注工程设计的独立代码基线。`design-engine-v2` 是从 `design-engine` 的 `5dfde32` 筛选文件后建立的无父提交分支；原分支保留完整应用与历史。

## 双层架构

- [element/](element/README.md)：可复用元件定义、14 类元件、版本化契约、接口、元件库与检索。元件自身的几何、端口、内部运动和行为由这一层持有。
- [engine/](engine/README.md)：选择和组合元件，管理设计方案、实例布局、跨元件连接、编译、投影、仿真与检查。方案通过固定版本引用元件。
- [engine/interface/](engine/interface/README.md)：独立设计界面、3D 与拓扑视图、运动预览、元件库检索。
- [engine/custom_model/](engine/custom_model/README.md)：条件包、命令建模、JSCAD 几何预览及逐零件 STL 导出。
- [examples/](examples/README.md)：元件、装配和迷你机械臂案例，以及案例生成脚本。

本分支不包含 agent 编排、模型提供商配置、阶段审批、应用服务端或固件流水线。Python 核心与本地界面不需要 API 密钥。

## 安装与运行

需要 Node.js 22+、npm、Python 3.11+。在仓库根目录执行：

```sh
python -m venv .venv-engine
# 按操作系统激活虚拟环境，然后安装 Python 依赖。
python -m pip install -r requirements.txt
npm ci
npm run dev
```

打开 http://127.0.0.1:4322。启动器和测试脚本优先使用 `MAKE_ENGINE_PYTHON`，其次使用 `.venv-engine`，最后使用 PATH 中的 `python`。可选 STL 碰撞依赖见 [engine/requirements-mesh.txt](engine/requirements-mesh.txt)。

```sh
python -m element schema element_definition
python -m engine schema design_package
python -m engine validate examples/engine/actuator.bundle.json
python -m engine simulate examples/engine/actuator.bundle.json --scenario examples/engine/actuator.scenario.json
```

## 验证

```sh
npm run check
npm test
npm run build
npm run test:ui:standalone-engine
```

`npm test` 运行 TypeScript 定制模型测试，以及 `element/tests`、`engine/tests` 两套 Python 测试；Python 未安装或依赖缺失会明确失败。可单独运行 `npm run test:python`。浏览器测试需要 Chromium，可通过 `MAKE_TEST_BROWSER` 指定可执行文件；构建产物写入 `engine/interface/dist/`，可用 `npm run preview` 预览。

运行数据、检索索引、本地项目和测试产物均不提交。运行数据位于忽略的 `workspace/`。案例使用合成假设；仿真、几何预览和 STL 导出均不代表物理验证、制造成功或可制造性认证。
