# 工作台外观、同源轮廓与概念参考

正式交付先建立真实外形，再在这一外形内布置硬件。两组视图共享同一个版本化CAD，分别展示外表与内部布局。

| 交付                     | 生成方式                                                 | 证据                                                                               |
| ------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 外观正/俯/侧视图与轴测图 | 同一参数化外形STEP/STL，固定正交相机渲染，不显示内部主板 | `generationMethod:appearance_geometry`，同一`appearanceRef`与`geometryDigest`      |
| 零件轮廓三视图           | 同一外形与真实硬件网格，按确定位置/旋转正投影，仅轮廓线  | `generationMethod:geometry_projection`，同一外形引用，实际结构调用ID及STEP干涉报告 |
| 可选造型参考图片         | 已配置的专用生图模型                                     | `generationMethod:image_model`，不保证几何一致，不能充当正式三视图                 |

## 产品经理的调用顺序

1. 分析与硬件选型提供真实型号、尺寸、接口和必要外部特征。
2. 外观设计师输出`structure/appearance-design`，协议`dreamatic.appearance/1`。通过2–8个圆角矩形或椭圆截面放样真实外形，指定内腔名义壁厚、颜色、窗口、按钮与接口。参数为设计提案，未知估值必须保留在`assumptions`。尺寸包络不是外形替代物。
3. 产品经理另派设计师依赖该设计，调用`build_appearance_geometry(designItemId)`。可信固定Python程序实际构建外形、内腔、开孔和可见表面，检查实体有效性、正体积、单壳体及STEP回读，保存STEP/STL并渲染四图。模型不能自行创建`appearance-model`或`generated-image`。
4. 结构工程师同时依赖真实外形和硬件结果，在`enclosure-instance.properties.appearanceItemId`绑定工具返回的外形条目ID，后端回填实际网格、边界、世界位置与版本；不可改写外形尺寸/坐标，也不能重新造box作为外壳。每次结构调用输出包含全部保留实例的完整快照；即使只移动一件也需带上未变更实例与预留体积，不能把单件差量当成全件布局。投影和完成前都会检查覆盖范围。零件用真实`geometryItemId`与位置/旋转布置；没有模型的模块只能保留为明确的假设预留体积。
5. 再派设计师依赖结构结果调用`render_component_views(sourceInvocationId)`。使用同一外观CAD轮廓及真实零件网格的轮廓/锐边，不用凸包补造形状。两组视图使用相同的世界坐标和毫米/像素比例。固定相机为：正视从+Y看向原点、俯视从+Z、右侧视从+X；轴测也使用平行投影。

外形放不下时必须调整布局或重新设计外形，生成新版本并重检。新项目与已明确要求几何一致的旧项目，在结构前检查同一外形的四视图，在完成前检查最新同源零件三视图及干涉结果。缺口通过认证界面显式确认可继续，但不会把未知或碰撞改写成已验证。

## 几何检查的范围

轮廓执行器对绑定真实STEP的零件逐个实体作与外壳的布尔相交、与外体的差集，以及元件间的实体相交，记录体积和阈值。供应商装配STEP可能含相交子实体与游离边，不能直接把整个混合Compound当作一个不相交实体集合；检查按实体执行，避免Compound布尔返回错误残留体积。

这项检查只覆盖有来源绑定的实体及指定位置，不代表完成装配分件、安装强度、线缆、插拔、公差、制造或实物验证。OLED等无STEP的预留体积仍是设计假设。当前外形工具支持截面放样与接口特征，不是任意照片的精确三维重建，也不是完整制造CAD。

## 保存、安全与界面

外形资产在忽略目录`workspace/workbench/appearance/<UUID>/`，图片在`workspace/workbench/images/`，以SHA-256和外形revision绑定。缓存包含设计、来源条目及生成/渲染程序摘要；修改外形或执行器会产生新证据。资产下载使用认证应用路由`/workbench-api/appearance/<UUID>/<asset>?revision=...&sha256=...`，拒绝路径越界、版本不符或文件哈希不符。没有任意Python执行、shell或审批agent工具。

浏览器“外观”将“统一外形 · 几何一致三视图与轴测图”、“零件布置 · 轮廓三视图”和“造型参考 · 概念图片”分开显示，可下载真实外形STEP。“结构”从认证资产载入真实曲面网格；外形加载失败时不画假box顶替。历史包络与独立生图保留为历史结果，不能声称已经满足当前几何交付。

## 验证

应用检查：`npm run check`、`npm test`、`npm run build`、`npm run test:workbench:ui`。

真实几何回归（使用包含build123d/OCP/trimesh/matplotlib的Python）：

```sh
MPLCONFIGDIR=workspace/workbench/.matplotlib ../CAD生成相关/DreamaticMake/.venv/bin/python workers/workbench/test_appearance.py workspace/workbench/appearance-regression
```

覆盖：实际放样/挖腔/STEP回读、内部元件通过、处于AABB内但越出真实圆角的元件拒绝、元件相交拒绝、两组同尺度投影，以及保留凹形轮廓而非凸包。
