# 本地集成更新 · 2026-10-22

已合入 `origin/codex/engine-web-integration` 的 `0dd441b47ef5a51cf2cc38422cd4e4eaace5a9d7`。本地分支为 `local/integration-20261022`，保留实时采购库、项目列表导航和 120 秒审阅完善倒计时。

设计引擎使用独立 `.venv-engine`（Python 3.11、Pydantic 2、Trimesh、python-fcl、Rtree）；配置项 `MAKE_ENGINE_PYTHON` 已指向 `.venv-engine/bin/python`。原 `.venv` 继续用于外壳 CAD 和固件，不改写原工具链依赖。

界面：项目 → CAD 工作台 → 设计引擎；原参数化建模位于“外壳 CAD”。新阶段校验要求结构及后续阶段具备当前版本的引擎模型和执行证据。已有项目不会自动重建分析模型；后续执行时按新规则补齐，用户确认仍由应用审批路由执行。

本机验证：TypeScript 检查、生产构建；68 项 Node 测试（包含真实 Python/FCL 和 AgentEngine 接口，无跳过）；75 项引擎 Python 测试；5 项采购库读取测试；引擎网页（含 STL）、项目导航/语言及倒计时浏览器回归均通过。未调用远程模型，也未验证实物。

源码备份：`backup/local-before-engine-20261022` 分支；运行数据备份：上级 `tmp/DreamaticMake-backup-20261022/workspace.tar.gz`。该备份目录另有设计引擎安装版本清单。未推送本地提交或合并 GitHub PR。
