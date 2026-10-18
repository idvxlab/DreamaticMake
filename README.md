# DreamaticMake

面向创客的本地智能终端产品设计工作台。基于 **Pi 1.3.0 SDK**，参考 Dreamatic 的分层架构和视觉语言，实现需求、意图、硬件、外观、结构、CAD、固件与交付的八阶段工作流。

当前版本是可运行的工程原型：包含真实模型接入、八种智能体、独立审阅与用户确认、CAD 几何工作进程、Pico 固件编译、3D 预览和项目导出。支持范围和验证结果见下文，不将自动化检查视为实物认证。

## 启动

要求 Node.js >=22.19、Python 3.11。当前工程执行隔离适配 macOS（Apple Silicon 环境已验证）；其他平台可运行 Web/项目基础能力，但工程工具会拒绝在没有隔离适配时执行。

```bash
npm ci --ignore-scripts
python3 -m venv .venv
.venv/bin/python -m pip install -r workers/cad/requirements.lock
npm run build
npm run server
```

打开 **http://127.0.0.1:4320**。开发模式使用 `npm run dev`，前端地址为 http://127.0.0.1:4321。

从左上角 **DreamaticMake 下拉菜单 → Settings** 打开配置，按推理模型、图像模型、CAD 设置、系统设置四个模块填写。推理服务填写兼容 Chat Completions 的 API 地址、模型和 API Key。视觉功能要求模型支持图片输入；可在图像模型模块单独配置 API 地址、密钥和模型；空字段沿用推理配置，旧 `MAKE_VISION_MODEL` 继续兼容。设置保存到本仓库 `.env`，浏览器读取接口不返回密钥。未配置模型时，仍可创建项目、编辑参数、使用 `90×65×35` 格式提取尺寸并生成 CAD；智能对话和通用图文理解需要真实服务配置。

首次固件构建需要网络下载 PlatformIO 工具链，建议将工作进程超时设置为 600 秒。工具链缓存保存在 `workspace/.system/toolchains/platformio`，不会写用户的全局 PlatformIO 环境。

## 硬件资料入口与失败恢复

Settings → 系统设置 → **硬件资料入口（HTTPS）** 配置 `MAKE_RESEARCH_SOURCES`，默认 `https://www.raspberrypi.com/products/`。多个入口用逗号或空格分隔，最多 20 个；保存后下次任务生效。入口路径作为爬取起点，访问权限以精确域名为界、不限制路径；树莓派入口自动包括 `raspberrypi.com`、`www.raspberrypi.com`、`datasheets.raspberrypi.com`、`pip.raspberrypi.com`，其他来源需单独添加，不自动信任任意子域。所有跳转也检查来源，连接时拒绝内网 DNS 地址。

`research_fetch` 提取单页；`research_crawl` 从入口发现与关键词相关的链接，单次最多读取 3 页。正文与链接通过固定版本 Cheerio 解析，每页限制 2MB、20 秒和 3 次跳转，返回并保存最终 URL、时间、标题、正文、截断标记及未解析链接。支持静态 HTML、文本、JSON；不执行网页脚本，不解析 PDF/STEP，不绕过人机验证。默认树莓派入口若返回 Cloudflare 403，需提供可读资料或改用另一个已配置的官方静态入口。抓取成功仅代表取得文本，不能自动证明尺寸、许可或电气参数已核验。

目录检索使用分词关键词匹配。硬件作者发现缺少器件时，应先补充来源并登记候选，或发布问题卡请求精确型号和资料；未解决的空目录检索会在提交时转为问题卡，不能用纯文字代替完整选型。只有外观与结构阶段能提交机械参数（含候选参数），工具 Schema 与服务端执行相同限制。

失败时在项目阶段保存 `failureSummary`（阶段、版本、失败时间、终止原因和最近工具错误），包括 Pi 在执行前拒绝的参数校验错误。下一轮协调者与专业作者均会收到摘要及当前来源配置；已有旧失败记录会从事件中补建摘要。重新打开阶段导致版本失效时清除旧摘要。超时和主动取消显示不同原因，不再统一只显示 `aborted`。

## 工作台与语言

侧栏“搜索项目”下方的“工作台”返回默认欢迎页面，可新建项目或从示例方向开始。返回工作台只切换页面，不会取消后台运行任务、删除项目或改变阶段结果；手机窄屏保留工作台图标入口。

Settings → 系统设置 → **界面语言** 可选择简体中文或 English（`MAKE_LANGUAGE=zh|en`）。保存后界面、设置说明、阶段状态、操作按钮和表单立即切换，刷新后从服务端恢复；无需为语言切换重启服务。智能体与图文参数理解在下一轮任务使用所选语言。已有项目名称、需求、对话、资料及工程内容保留原文。

`npm run test:ui:language` 使用独立临时工作目录和无头 Chrome 验证工作台导航、语言切换与持久化、移动布局，以及返回工作台不取消后台任务，不调用付费模型。

## 项目工作目录

默认工作目录为系统源码根目录下的 `workspace`。从左上角菜单 → Settings → 系统设置 → **项目工作目录** 修改；支持绝对路径，或相对于系统源码根目录的路径（不以启动终端所在目录为基准）。设置保存到 `MAKE_WORKSPACE`，重启服务后生效。切换工作目录不自动搬迁原有项目；切回原路径即可重新打开原项目。

```text
workspace/
  .system/                  共享系统数据，不属于任何单一项目
    runtime/                模型运行时配置
    custom-parts.json       新项目使用的部件种子目录
    toolchains/platformio/  固件工具链缓存
  <项目ID>/                 每个项目独立，重命名项目不会改变目录或 ID
    project.json            项目元数据、阶段状态和审批
    events.jsonl            项目事件流
    context/                阶段上下文快照
    hardware/catalog.json   本项目部件与实测尺寸
    uploads/                用户上传文件
    uploads.json            上传文件索引
    sources/                参考资料目录
    sessions/               本项目各智能体的 Pi 会话
    jobs/                   CAD/固件任务源码、日志与构建结果
    artifacts/              带哈希登记的阶段产物
    reports/                项目报告目录
    exports/                导出包
    history/                项目历史版本
```

新项目创建时初始化自己的部件目录；后续硬件候选和测量仅写入当前项目，不修改其他项目。项目文件下载按项目归属与产物哈希校验。

旧版 `workspace/projects/<项目ID>/` 在下次启动时自动移至 `workspace/<项目ID>/`，保留 ID、相对文件路径、会话、审批与历史。共享数据移至 `.system`。遇到目标目录冲突会停止迁移并保留原文件，不覆盖项目。

## 工作方式

1. 新建项目，描述功能、场景、预算和已有硬件。
2. 开始当前阶段；协调者将任务交给专业智能体，必要时在对话中展示问题卡。
3. 作者提交结构化成果后，由独立会话审阅，再展示用户审批卡。
4. 前六个设计阶段必须逐项预览并确认；固件和交付也提供审阅与确认。
5. 修改需求或参数会使受影响阶段失效，旧审批不能授权新版本。
6. 工程文件中可预览代码、配置和报告；导出包只收录已确认阶段，清单标明是否完整。

## 智能体与协议

独立描述文件位于 `.pi/agents/`，标准字段包括 id、name、version、mode、allowed_tools，并统一定义职责、输入输出、合作边界与停止条件。

| 智能体              | 职责                               |
| ------------------- | ---------------------------------- |
| orchestrator        | 面向用户协调，只调度当前阶段       |
| analyst             | 需求分析、意图理解、澄清问答       |
| hardware-engineer   | 部件目录、官方资料、硬件候选与接口 |
| industrial-designer | 受硬件约束的外观方案与参数候选     |
| mechanical-engineer | 分件、固定、开孔、装配与结构参数   |
| cad-engineer        | 参数化 CAD、图文参数解释、工程执行 |
| firmware-engineer   | 固件源码、固定平台配置、实际编译   |
| reviewer            | 独立审阅；交付阶段汇总已有结果     |

协议见 [.pi/PROTOCOL.md](.pi/PROTOCOL.md)。运行时加载 MD 白名单，专业会话没有任意 shell、文件写入或用户审批工具。交付作者与审阅使用独立会话和不同工具集合。默认每项目一个执行链；不同项目的数据和事件分离。

## 工具与支持范围

- **文生 CAD**：自然语言经模型提取参数；显式 `宽×深×高` 可离线解析。参数确认后使用 build123d/Open Cascade 生成真实实体，含带定位边的盖板，装配总高与参数一致，打印 STL 自动放置到底面，输出 STEP、分件 STL、参数、源码、验证报告和只供参考的部件网格。
- **图生 CAD**：带毫米尺度的参考图经视觉模型提取候选参数，用户确认后建模。当前拟合参数化矩形上下壳，不能从任意图片恢复精确自由曲面或内部结构。
- **结构特征**：接口/顶盖矩形开孔、螺柱、壳体固定孔、部件包络放置。验证边界、实体、体积、STEP 回读、STL 闭合、部件间和部件与壳体的碰撞。未建模的插头、线缆、热学与打印公差仍需确认和实测。
- **硬件资料**：本地目录检索、配置的官方域名网页抓取、带来源的候选导入。首批目录包含 Raspberry Pi Pico，许可已有官方来源，安装高度需要用户实测；工具不会把缺失尺寸升级为已核验事实。
- **固件**：当前构建适配 Raspberry Pi Pico + Arduino Mbed，PlatformIO 6.1.18、raspberrypi 1.20.0 与核心包固定版本。支持生成源码、实际编译、日志、版本清单及固件输出；未实现自动烧录、串口调试和任意板卡适配。
- **附件**：图片通过视觉模型理解，纯文本提供有界提取；PDF 当前保存为参考附件，尚无正文解析器，运行时明确标注。
- **设置和项目**：`.env` 原子保存、秘密字段掩码、工具诊断、创建/搜索/重命名/归档/恢复、SSE 续接、执行取消和 ZIP 导出。

CAD/固件在 macOS Seatbelt 默认拒绝沙箱中运行，仅读取系统/工具链及当前任务目录，写入任务和专用缓存；CAD 不允许网络，固件允许下载工具链。不会在沙箱失败后静默降级为无隔离执行。

## 验证

```bash
npm run check
npm test
npm run build
npm run test:engineering
npm run test:pipeline
npm run test:ui
```

- `npm test`：审批、角色/版本、幂等、候选/问答、产物篡改、并发事件、恢复、配置与 API；包含 Pi 1.3.0 的实际 SDK 工具调用，使用本地确定性模型端点。
- `test:engineering`：真实 CAD 开孔/支柱/包络、碰撞反例、文件隔离、真实 Pico 编译。
- `test:pipeline`：本地确定性模型夹具驱动八阶段 Pi 会话，结合真实 CAD/固件，逐项验证独立审阅和用户确认门。用于验证执行机制，不代表外部模型的设计质量。
- `test:ui`：独立 Chrome 会话验证项目、卡片、CAD、设置和移动布局；默认 Chrome 路径为 macOS 标准安装路径。截图位于 `test-results/`。

工程报告保存在 `workspace/validation/`。尚未使用用户的远程模型密钥做真实设计质量验收，也未完成实体打印、装配或烧录测试。

## 目录

```text
apps/web/                  React 工作台与可复用交互组件
apps/server/               本地 HTTP/SSE、上传、导出、工程服务
packages/core/             Schema、存储、工作流、设置、沙箱和进程
packages/agent-runtime/    Pi 会话、角色权限和领域工具
.pi/agents/               八个标准化智能体定义
.pi/PROTOCOL.md            智能体合作协议
workers/cad/               build123d 参数化建模与锁定依赖
catalog/                   有来源和核验状态的种子部件
scripts/                   开发与工程/UI 集成验证
workspace/                 忽略提交的项目、工具链和执行证据
```

产品方案见 [docs/system-design.md](docs/system-design.md)，实现状态见 [docs/implementation-status.md](docs/implementation-status.md)。

### 单选与多选澄清

问题卡按语义显式区分 `selection: single|multiple`。可并存的功能、显示内容与使用场景应生成多选题；互斥方案生成单选题。多选可逐项选中/取消，也可补充自定义答案，与选择项一起以数组保存。必填多选至少提供一项，单选继续使用字符串；未标题型的旧卡片保持单选兼容。历史回答不被自动改写。
