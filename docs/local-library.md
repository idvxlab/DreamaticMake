# 实时本地采购库

## Arduino 官方硬件

同一目录可提供 `official_catalog/library/hardware.sqlite3`。当前已索引 122 个公开硬件、594 篇硬件关联文档及 63 个内容去重 STEP 模型。官方候选和电商候选分别标记 sourceType，采购需求模板仍独立返回。原 `parts_library`、`components.sqlite3` 和采购证据不修改、不按名称强行合并。

在仓库根目录运行 `npm run library:sync -- ../小家电元件库` 构建或更新官方索引；同步从采集 SQLite 的一致性只读快照读取，生成独立 SQLite 后原子替换，旧索引自动备份到 `official_catalog/library/backups/`。原始采集文件保留。STEP 清单来自 `official_catalog/runs/all/step_inventory/inventory.json`；如果又下载了新模型，先运行源库的 `official_catalog/inventory_step_models.py` 刷新该清单，再同步。此命令不抓网页、不调用模型、不执行原始资料中的代码。

在硬件页面或 CAD 页的“搜索硬件资料与检查 STEP 模型”中，可搜索中文功能、英文名称和 SKU，查看参数原文、分页手册，下载 STEP/Pinout/原理图/CAD 等资源。检索优先提供官方候选；候选数据不足不代表可以按目录名称推测尺寸。文件只按候选与资源 ID 读取，检查根目录、真实路径和 SHA-256；不允许客户端提供任意本地路径。同步后的文件若改动，下载和检查拒绝使用旧哈希，需重新同步。

硬件、结构、CAD 与审阅角色可用以下工具：

运行时的资料读取与 STEP 检查接入独立放在 `packages/agent-runtime/src/library-tools.ts`，共用 `runtime.ts` 通过 `registerLibraryTools` 注册。修改通用数据库或工作流入口时应保留这个注册点，以及 `catalog_add` 的 `officialLibraryReference` 来源关联；不要用其他聊天的旧整文件覆盖当前入口。同步脚本、只读查询、检查 worker 和官方索引均与通用数据库入口分开。

- `catalog_search(query)`：搜索统一接口，返回带来源类型的官方及采购候选、参数摘要、模型数量和独立需求模板。
- `local_library_read(candidateId, documentId?, offset?)`：保存当前官方参数／手册原文与模型清单为项目的版本证据。手册每次最多 40000 字符，nextOffset 明确后续位置。
- `local_library_check(candidateId, modelId, availableEnvelopeMm?, clearanceMm?)`：将已核对内容哈希的 STEP 复制到隔离工作目录，实际通过 OpenCascade/build123d 读取，返回原始 XYZ 包络、实体数量及 BREP 有效性；可比较指定 XYZ 空间和每侧间隙。原 STEP 和报告均写入项目产物，报告包含候选、模型 SHA-256、来源、索引指纹和项目阶段版本。

`catalog_add` 采用官方来源时保留 libraryRef（candidateId、来源数据哈希和 URL），但不会自动选择、审批或将 geometryVerified 设为 true。新索引不覆盖已确认项目的来源快照。空间检查沿用模型原坐标轴，不自动交换长宽或旋转，不证明孔位、插头、线缆、散热、电气适配或实物试装；没有配置空间时也不声称空间适配。STEP 读取报告不是电路／行为模型，未自动接入装配碰撞。Arduino 固件编译不在本次接入范围，原固件平台限制保持有效。

HTTP 接口沿用只接受本机 Host 与同源请求的应用边界：

- `GET /api/local-library?q=...`、`?candidateId=...&documentId=...&offset=...`
- `GET /api/local-library/asset?candidateId=...&assetId=...`：仅下载该硬件关联的已保存文件，逐次核对内容哈希。
- `POST /api/projects/:id/local-library/check`：运行真实 STEP 包络检查并保存来源产物，不修改 BOM、参数或审批。

源采集仍有 274 个未完成／失败任务，索引不将它们伪装成成功资源。模型目录里相同硬件的不同导出可能分别保留，STEP 文件数量不等于可采购器件种类。模型可按需检查，不宣称全部模型都已成功通过 CAD 内核。

## 原有采购库

在系统设置的 `MAKE_LOCAL_LIBRARY` 填写小家电元件库根目录（包含 `parts_library` 与 `jd_purchase`）。使用 `MAKE_PYTHON` 指定的 Python 标准库读取，不运行采集脚本，不调用付费模型，不修改源数据库。

数据源为 `jd_purchase/runs/amazon_batch/purchase.sqlite3`、每条快照的 `.flash.json` 参数提取结果及原始页面快照；同时读取 `parts_library/data/parts_library.sqlite3` 的采购规格模板。排除进度中 skipped 的规格和未 captured 的记录。SQLite 以只读连接读取；每次查询重新打开数据库和参数文件，无需人工导出或重启。源库的目录结构变更需要适配，不自动扫描任意目录。

硬件页增加采购搜索、参数原文详情和 30 秒刷新。后台 `GET /api/local-library?q=...` 返回检索和更新指纹；`candidateId` 查询当前详情。指纹包含数据库/WAL、进度、计划和原始/提取文件的修改状态。并发采集中的不完整文件暂时跳过，并显示数量；下一次查询重试。

硬件 AI 的 `catalog_search` 同时检索项目目录与实时采购库；`context_read` 为硬件阶段提供基于项目名和描述的初步检索。`local_library_read` 保存当前商品参数、原文、来源 URL、文件 SHA-256 与更新指纹到该项目的 source 产物。随后可按原来的 `catalog_add` 流程登记尺寸充分的候选。数据不足时必须保留缺口，不能用猜测尺寸通过 Schema。

商品记录与需求模板独立返回。参数只保留同一 ASIN/URL 且原文可逐字核对的提取值。采集不是实测，geometryVerified 始终不因检索自动设为 true。新数据即时用于检索，已确认项目和已保存来源快照不自动覆盖；采用新参数时需要重新提交审阅。这避免持续爬取意外改变已确认设计。
