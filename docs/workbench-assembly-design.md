# assembly-design/1 最小几何能力

独立于 appearance/1，不修改旧外形格式或历史项目。Schema 在 packages/workbench/assembly-contracts.ts，执行 API 为 assembly-tools.ts 的 executeAssemblyDesign(design, resolvedAssets, expectedInstanceIds, outputDirectory)。此函数现通过机械角色专用 build_printable_assembly(designItemId) 接入。先用 assembly_design_contract 读取精确合同，提交已有设计条目，再在下次有界任务执行；由 AssemblyStore 使用 AppearanceStore/HardwareLibrary 解析本地路径与摘要，验证 appearanceRef 对应 shell/outer，锁定完整布局实例及原生坐标变换。不允许模型直接指定文件路径。审批仅在认证应用路由。

版本为 dreamatic.assembly-design/1，mm、xyz-mm-center-z-up/1；源绑定包括 appearanceRef、shellSha256、outerSha256，instances 每项含稳定 id、完整 geometryRef、原始CAD坐标的 translationMm 和 XYZ rotationDeg。入口必须与 expectedInstanceIds 精确一致；worker逐文件验证SHA和有效实体。调用方必须自己确定前序快照，不能把模型自报ID清单当可信基线。

split 仅支持Z平面与显式 gapMm。mounts 提供安装/限位圆柱、通孔、目标实例、底面/顶面/半径；检查底座锚定、到目标的名义接触距离和最终零件干涉。keepouts 是显式 wire/connector 假设包络，检测与壳体、安装柱、真实源零件的布尔占用及是否越出outer。它们是空间预留，不是实际线束CAD。print 显式给出bedMm、材料和间隙假设，assemblyOrder为待执行步骤而非已完成记录。

每片导出独立 base/lid STEP与STL，另有*-assembly.step保存回装坐标。报告记录打印平移及其反向回装平移，检查有效单实体、正体积、打印床包络、STEP重新导入有效、回装分片不交叠、零件越界与干涉、安装柱锚定和目标名义接触、keepout占用。报告geometryChecksPassed仅聚合这份声明的有限几何检查，不是制造/打印/装配通过。printed、physicalVerified、assemblyVerified固定false；完整设计、工具版本、执行器摘要、输入和输出资产摘要可追踪。

旧输入未提供closure时不生成盖体定位/紧固结构；提供closure时生成下述定位销/孔与螺钉柱几何。安装孔及名义啮合不证明螺纹受力保持或夹紧。线束弯曲半径、连接器插入路径、装配可达性/顺序、支撑、打印方向优化、材料收缩及实测公差未验证。平面切割会移除gap体积，不能当严密闭合外壳；报告明确gap。不能用这些结果宣称番茄钟整机可制造。

真实smoke：用已有build123d Python执行 workers/workbench/test_assembly.py <独立输出目录>。合成STEP测试夹具而非厂商硬件；正常双片及安装/限位/走线检查、占用走线/小床/碰撞反例，以及实际ShapeList多实体布尔结果。TS独立测试覆盖合同、非法安装参数及完整实例入口拒绝。最终共享check/test/build由总协调执行。


## 2026-10-29 可选 closure：真实定位与紧固特征

API及asset命名保持不变。closure不存在时保留旧输入/几何行为，report.closure.provided=false、passed=false并保留未生成紧固缺口；这不等于旧输入有盖体保持能力。存在时要求至少两个locators和两个fasteners、全组ID唯一且圆柱座包络不重叠。closure.assumption必须说明设计假设。

locators参数：id、centerMm=[x,y]、pinRadiusMm、bossRadiusMm、anchorDepthMm、engagementMm、radialClearanceMm、axialClearanceMm、roofMm。底座生成扩大锚定脚及跨越分件面的定位销，上盖生成与壁体连接的盲孔柱座；减去pinRadius+radialClearance的圆孔，孔底比销尖高axialClearance。检查两个柱座真实体积锚定、销与盖实际布尔不交叠及最小实际距离符合间隙。

fasteners参数：id、centerMm、baseZMm、bossRadiusMm、pilotRadiusMm、screwRadiusMm、clearanceRadiusMm、headRadiusMm、pilotDepthMm、screwLengthMm、minEngagementMm、tipClearanceMm、source={basis:assumed|documented,reference:string}。生成上下盖柱体、上盖螺钉通孔和下盖盲导孔，校验柱体锚定、通孔与名义螺杆无干涉、长度确定的轴向啮合/底部余隙、螺钉头与实际柱顶的名义支承截面积。半径要求pilot<screw<clearance<boss，head>clearance。不建螺旋牙型或仿真自攻过程；pilot与名义螺钉的径向过盈作为有意的假设单列，不能当成螺纹实际强度/寿命证明。source=documented只是来源分类，调用方仍需绑定实际资料。

report.closure包含provided、locators、fasteners、passed；每个定位记录含baseAnchored/lidAnchored、nominalEngagementMm、nominalRadialClearanceMm/nominalAxialClearanceMm、pinLidIntersectionMm3、measuredMinClearanceMm、passed；紧固记录含source、nominalHeadBearingAreaMm2、baseAnchored/lidAnchored、axialEngagementMm、tipClearanceMm、radialThroughClearanceMm、lidShankIntersectionMm3、nominalThreadInterferenceMm、passed。geometryChecksPassed在提供closure时要求其全部通过，且新增壳体几何不得越出outer；旧字段、六份asset不变。真实打印/实物装配状态依旧false。

真实回归使用build123d 0.10.0：旧输入通过；新closure夹具每片单solid/正体积/声明打印床通过，定位最小间隙约0.2mm，名义轴向啮合5.8mm，螺钉底部余隙2.2mm，头部实际支承截面积约18.10mm²，回装交叠0mm³。短螺钉、悬空定位座、重复定位座、被占用的wire及connector空间、小床和碰撞均有负例。它们仅证明该合成夹具下的几何能力；仍须核实材料收缩、公差、支撑、螺纹强度及实际工具/连接器/线束可达性，不能宣称用户硬件已打印装好。


## 应用执行证据与下载

AssemblyStore 保留 sourceItemId、sourceLayoutInvocationId、真实worker报告及文件摘要；Invocation.assemblyEvidence 保存应用独占的 assembly-model，模型不能自行创建。几何检查失败仍保存报告与产物，且不提升为成功。模型后续响应失败也不会删除已经完成的工具证据。未完成的 reserved-volume 可以继续概念设计，但不能冒充完整实际零件装配检查。

浏览器结构页展示执行范围、闭合/分件检查、完整报告与七份下载（六份几何文件加report.json）。下载只走认证应用路由 /workbench-api/assembly/{UUID}/{asset}，必须匹配版本与SHA-256；本地任意路径、未知文件名及摘要变更均拒绝。旧历史项目不自动改写，不把合成测试产物当成番茄钟整机结果。
