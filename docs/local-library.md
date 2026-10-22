# 实时本地采购库

在系统设置的 `MAKE_LOCAL_LIBRARY` 填写小家电元件库根目录（包含 `parts_library` 与 `jd_purchase`）。使用 `MAKE_PYTHON` 指定的 Python 标准库读取，不运行采集脚本，不调用付费模型，不修改源数据库。

数据源为 `jd_purchase/runs/amazon_batch/purchase.sqlite3`、每条快照的 `.flash.json` 参数提取结果及原始页面快照；同时读取 `parts_library/data/parts_library.sqlite3` 的采购规格模板。排除进度中 skipped 的规格和未 captured 的记录。SQLite 以只读连接读取；每次查询重新打开数据库和参数文件，无需人工导出或重启。源库的目录结构变更需要适配，不自动扫描任意目录。

硬件页增加采购搜索、参数原文详情和 30 秒刷新。后台 `GET /api/local-library?q=...` 返回检索和更新指纹；`candidateId` 查询当前详情。指纹包含数据库/WAL、进度、计划和原始/提取文件的修改状态。并发采集中的不完整文件暂时跳过，并显示数量；下一次查询重试。

硬件 AI 的 `catalog_search` 同时检索项目目录与实时采购库；`context_read` 为硬件阶段提供基于项目名和描述的初步检索。`local_library_read` 保存当前商品参数、原文、来源 URL、文件 SHA-256 与更新指纹到该项目的 source 产物。随后可按原来的 `catalog_add` 流程登记尺寸充分的候选。数据不足时必须保留缺口，不能用猜测尺寸通过 Schema。

商品记录与需求模板独立返回。参数只保留同一 ASIN/URL 且原文可逐字核对的提取值。采集不是实测，geometryVerified 始终不因检索自动设为 true。新数据即时用于检索，已确认项目和已保存来源快照不自动覆盖；采用新参数时需要重新提交审阅。这避免持续爬取意外改变已确认设计。
