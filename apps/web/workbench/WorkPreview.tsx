import { useState } from "react";
import {
  ArrowUpRight,
  Box,
  Check,
  Code2,
  FileImage,
  Layers,
  Network,
  RotateCcw,
} from "lucide-react";
import {
  channels,
  channelNames,
  roleNames,
  type Invocation,
  type Project,
  type Packet,
} from "../../../packages/workbench/contracts";
import { AssemblyEvidence } from "./AssemblyEvidence";
import { ItemEvidence } from "./Evidence";
import { Preview } from "./Preview";
import { bomBaselineSchema } from "../../../packages/workbench/hardware-contracts";
import {
  imagePreviewItems,
  inheritedImagePackets,
} from "../../../packages/workbench/image-preview";

type Props = {
  project?: Project;
  node?: Invocation;
  selected?: string;
  select: (id?: string) => void;
  details: () => void;
  answers: Record<string, string>;
  setAnswer: (id: string, value: string) => void;
  confirm: () => void;
  continueWithGaps: (projectId: string, reason: string) => void;
  pending: boolean;
};
const labels: Record<string, string> = {
  dimensionsMm: "尺寸 / mm",
  positionMm: "位置 / mm",
  rotationDeg: "旋转 / °",
  voltage: "电压",
  voltageV: "电压 / V",
  currentMa: "电流 / mA",
  components: "元器件",
  alternatives: "备选",
  tradeoffs: "取舍",
  function: "功能",
  interfaces: "接口",
  power: "供电",
  cost: "成本",
  prompt: "生成要求",
  view: "视图",
  status: "状态",
  reason: "原因",
  code: "代码",
  firmware: "固件",
  constraints: "约束",
  selected: "选择",
  materials: "材料",
  model: "生图模型",
  width: "宽 / px",
  height: "高 / px",
};
function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>—</span>;
  if (typeof value === "boolean") return <span>{value ? "是" : "否"}</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (Array.isArray(value))
    return value.every((v) => typeof v !== "object") ? (
      <span>{value.map(String).join(" · ")}</span>
    ) : (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} />
          </li>
        ))}
      </ul>
    );
  return (
    <dl>
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k}>
          <dt>{labels[k] || k}</dt>
          <dd>
            <Value value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
function ImageAsset({ item }: { item: Packet["data"]["structure"][number] }) {
  const [failed, setFailed] = useState(false);
  const raw = item.properties.imageUrl;
  const safe =
    typeof raw === "string" &&
    (/^https:\/\//.test(raw) ||
      /^\/assets\//.test(raw) ||
      /^\/workbench-api\/images\/[a-f0-9-]+$/.test(raw))
      ? raw
      : undefined;
  return (
    <article className="image-asset">
      <div className="image-surface">
        {safe && !failed ? (
          <img src={safe} alt={item.label} onError={() => setFailed(true)} />
        ) : (
          <>
            <FileImage size={29} strokeWidth={1} />
            <span>{failed ? "图像引用不可用" : "待生成图像"}</span>
          </>
        )}
      </div>
      <h4>{item.label}</h4>
      {safe && !failed && (
        <a href={safe} download>
          下载图片
        </a>
      )}
      <span className="artifact-status">
        {safe && !failed
          ? item.kind === "generated-image"
            ? item.properties.imageSet === "component_layout"
              ? "零件轮廓正投影 · 装配未验证"
              : item.properties.imageSet === "appearance"
                ? item.properties.generationMethod === "appearance_geometry"
                  ? "同一CAD几何投影 · 装配与制造未验证"
                  : "造型参考图片 · 不保证几何一致"
                : "历史概念图 · 未按新规则拆分"
            : "参考图像 · 资产未验证"
          : "图像生成任务 · 尚无执行产物"}
      </span>
      <Value
        value={Object.fromEntries(
          Object.entries(item.properties).filter(([k]) =>
            item.kind === "generated-image"
              ? ["view", "model", "width", "height"].includes(k)
              : k !== "imageUrl",
          ),
        )}
      />
      {item.kind === "generated-image" && (
        <details>
          <summary>查看生成要求</summary>
          <p>{String(item.properties.prompt || "")}</p>
        </details>
      )}
    </article>
  );
}
export function WorkPreview({
  project,
  node,
  selected,
  select,
  details,
  answers,
  setAnswer,
  confirm,
  continueWithGaps,
  pending,
}: Props) {
  const [view, setView] = useState("perspective");
  const [exploded, setExploded] = useState(false);
  const [confirmGap, setConfirmGap] = useState(false);
  const questioning = project?.phase === "choices" && !selected;
  const questions = questioning ? project.questions : node?.questions || [];
  const isStructure = node?.role === "mechanical" && !questioning;
  const packet = node?.packet;
  const ownBaseline =
    packet &&
    channels
      .flatMap((c) => packet.data[c])
      .find((i) => i.kind === "bom-baseline");
  const baselineItem =
    ownBaseline ||
    (node?.decision?.action === "finish"
      ? [...(project?.nodes || [])]
          .reverse()
          .flatMap((n) =>
            n.packet ? channels.flatMap((c) => n.packet!.data[c]) : [],
          )
          .find((i) => i.kind === "bom-baseline")
      : undefined);
  const parsedBaseline = bomBaselineSchema.safeParse(baselineItem?.properties);
  const baseline = parsedBaseline.success ? parsedBaseline.data : undefined;
  const titles = {
    coordinator: "产品经理 · 调度决策",
    analyst: "调研与需求",
    embedded: "硬件选型与方案",
    designer: "外观与三视图",
    mechanical: "结构与装配",
    software: "软件与固件",
    reviewer: "独立审查意见",
  };
  const packets = packet ? [packet] : [];
  const hardwareCandidates = packet
    ? channels
        .flatMap((c) => packet.data[c])
        .filter((i) => i.kind === "hardware-option")
    : [];
  const candidateIds = new Set(hardwareCandidates.map((i) => i.id));
  const boundHardwareCount = new Set(
    hardwareCandidates
      .flatMap((i) =>
        Array.isArray(i.properties.hardwareRefs)
          ? i.properties.hardwareRefs
          : [],
      )
      .map((r) => JSON.stringify(r)),
  ).size;
  const { items: imageAssets, ids: imageIds } = imagePreviewItems(
    node,
    inheritedImagePackets(project, node),
  );
  return (
    <section
      className="preview-pane work-preview"
      data-preview={questioning ? "questions" : node?.role || "empty"}
    >
      <div className="pane-head">
        <span>
          <Layers size={16} />
          {questioning ? "需求澄清" : node ? titles[node.role] : "当前工作内容"}
          <small>WORKSPACE</small>
        </span>
        <button
          className={selected ? "preview-follow" : "preview-follow following"}
          onClick={() => select(undefined)}
        >
          {selected ? "跟随最新进度" : "跟随进度"}
        </button>
      </div>
      <div className="preview-context">
        <select
          aria-label="预览调用结果"
          value={selected || ""}
          onChange={(e) => select(e.target.value || undefined)}
        >
          <option value="">自动跟随当前工作</option>
          {project?.nodes.map((n, i) => (
            <option key={n.id} value={n.id}>
              {String(i + 1).padStart(2, "0")} · {roleNames[n.role]} · {n.title}
            </option>
          ))}
        </select>
        <button disabled={!node} onClick={details} title="查看调用详情">
          <Code2 size={15} />
        </button>
      </div>
      {project && (
        <nav className="preview-stage-tabs" aria-label="工作内容类别">
          {(
            [
              ["coordinator", "统筹"],
              ["analyst", "问题与分析"],
              ["embedded", "硬件"],
              ["designer", "外观"],
              ["mechanical", "结构"],
              ["software", "软件"],
              ["reviewer", "审查"],
            ] as const
          ).map(([role, label]) => {
            const candidates = [...project.nodes]
              .reverse()
              .filter((n) => n.role === role);
            const target =
              candidates.find(
                (n) =>
                  n.status === "running" || (n.status === "done" && n.packet),
              ) || candidates[0];
            return (
              <button
                key={role}
                className={node?.role === role ? "active" : ""}
                disabled={!target}
                onClick={() => select(target?.id)}
              >
                {label}
              </button>
            );
          })}
        </nav>
      )}
      {!project ? (
        <div className="work-empty">
          <div className="empty-orbit">
            <Network size={35} strokeWidth={1} />
          </div>
          <span className="eyebrow">PRODUCT MANAGER · AT THE HELM</span>
          <h2>先说说，你想做什么？</h2>
          <p>
            产品经理接收需求，按需委派专家。
            <br />
            这里会呈现每一阶段的实际工作内容。
          </p>
          <div className="preview-capabilities">
            <span>问题卡片</span>
            <span>硬件方案</span>
            <span>效果图 / 三视图</span>
            <span>结构模型</span>
            <span>软件与审查</span>
          </div>
        </div>
      ) : (
        <>
          {isStructure ? (
            <>
              <AssemblyEvidence node={node} />
              <div className="viewport structure-viewport">
                <Preview packets={packets} view={view} exploded={exploded} />
                <div className="view-select">
                  {[
                    ["perspective", "轴测"],
                    ["front", "前视"],
                    ["top", "顶视"],
                    ["right", "右视"],
                  ].map(([v, label]) => (
                    <button
                      key={v}
                      className={view === v ? "active" : ""}
                      onClick={() => setView(v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="viewport-tools">
                  <button
                    title="切换分解视图"
                    onClick={() => setExploded(!exploded)}
                  >
                    <Layers size={16} />
                  </button>
                  <button
                    title="重置视角"
                    onClick={() => {
                      setView("perspective");
                      setExploded(false);
                    }}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
                {!packet?.data.structure.some((i) =>
                  Array.isArray(i.properties.dimensionsMm),
                ) && (
                  <div className="empty-preview">
                    <Box size={35} />
                    <h3>
                      {node?.assemblyEvidence?.length
                        ? "分件执行报告已保存"
                        : "等待结构结果"}
                    </h3>
                    <p>
                      {node?.assemblyEvidence?.length
                        ? "查看上方执行报告与分件文件；此处暂无布局预览"
                        : "结构工程师返回尺寸或几何后在这里显示"}
                    </p>
                  </div>
                )}
                <div className="viewport-caption">
                  尺寸 / mm · Z 向上 · 网格状态见加载提示 · 装配与制造未验证
                </div>
              </div>
              <ItemEvidence packet={packet} />
              <div className="struct-summary">
                {packet?.summary ||
                  node?.error ||
                  "结构工程师正在处理外观、硬件与装配约束。"}
              </div>
            </>
          ) : (
            <div className="work-preview-scroll">
              {questions.length > 0 ? (
                <>
                  <div className="work-intro">
                    <span className="eyebrow">CLARIFY BEFORE DESIGN</span>
                    <h2>{questioning ? "把关键选择交给你" : "需求调研记录"}</h2>
                    <p>
                      {node?.packet?.summary ||
                        "调研团队提出会影响方案的关键问题，产品经理将在你的选择后继续安排。"}
                    </p>
                  </div>
                  <div className="workspace-questions">
                    {questions.map((q, i) => {
                      const editable =
                        project.phase === "choices" &&
                        project.questions.some((x) => x.id === q.id);
                      const value = answers[q.id] || project.answers[q.id];
                      return (
                        <article className="question-card" key={q.id}>
                          <span className="question-index">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <h4>{q.title}</h4>
                          <div>
                            {q.options.map((o) => (
                              <button
                                key={o}
                                className={value === o ? "chosen" : ""}
                                disabled={!editable || pending}
                                onClick={() => setAnswer(q.id, o)}
                              >
                                {o}
                                {value === o && <Check size={12} />}
                              </button>
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {project.phase === "choices" && (
                    <button
                      className="primary confirm-questions"
                      disabled={
                        pending || project.questions.some((q) => !answers[q.id])
                      }
                      onClick={confirm}
                    >
                      确认选择，交回产品经理
                      <ArrowUpRight size={15} />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="work-intro">
                    <span className="eyebrow">
                      {node ? roleNames[node.role] : "CURRENT WORK"}
                    </span>
                    <h2>{node?.title || "产品经理正在组织工作"}</h2>
                    {node?.status === "running" ? (
                      <p className="working-indicator">
                        <span className="live-dot pulse" />
                        {node.role === "coordinator"
                          ? "正在评估需求和已有结果，决定下一步调用"
                          : "正在执行产品经理委派的任务"}
                      </p>
                    ) : (
                      <p>{packet?.summary || node?.error || "等待工作结果"}</p>
                    )}
                  </div>
                  {baseline && (
                    <section className="bom-baseline" aria-label="成套硬件清单">
                      <div className="section-caption">
                        成套硬件清单
                        <span>{baseline.rows.length} 项 · 原型选型基线</span>
                      </div>
                      <p className="artifact-status">
                        型号与数量已关联专家结果；候选和定制项仍需工程验证。
                      </p>
                      <div className="bom-table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>物料</th>
                              <th>型号 / 设计编号</th>
                              <th>数量</th>
                              <th>状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {baseline.rows.map((row) => (
                              <tr key={row.itemId}>
                                <td>{row.name}</td>
                                <td>{row.partNumber}</td>
                                <td>
                                  {row.quantity} {row.unit}
                                </td>
                                <td>
                                  {
                                    {
                                      selected: "已选型",
                                      candidate: "候选",
                                      custom_required: "需定制",
                                      missing: "待补齐",
                                    }[row.selectionStatus]
                                  }
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {[
                        ["不重复计数", baseline.excluded],
                        ["装配与校准工序", baseline.procedures],
                        ["待核对事项", baseline.openChecks],
                      ].map(([title, values]) => (
                        <details key={String(title)}>
                          <summary>{String(title)}</summary>
                          <ul>
                            {(values as string[]).map((v, i) => (
                              <li key={i}>{v}</li>
                            ))}
                          </ul>
                        </details>
                      ))}
                    </section>
                  )}
                  {node?.decision && (
                    <div className="decision-card">
                      <span className="eyebrow">MANAGER DECISION</span>
                      <h3>
                        {node.decision.action === "dispatch"
                          ? "下一步委派"
                          : node.decision.action === "finish"
                            ? "本轮交付总结"
                            : "需要处理的缺口"}
                      </h3>
                      <p>{node.decision.reason}</p>
                      {node.decision.tasks.map((t) => (
                        <article key={t.key}>
                          <span>{roleNames[t.role]}</span>
                          <strong>{t.title}</strong>
                          <p>{t.instruction}</p>
                        </article>
                      ))}
                    </div>
                  )}
                  {node?.role === "embedded" && packet && (
                    <>
                      <div className="section-caption">
                        候选方案与元器件<span>交由结构工程师取舍</span>
                      </div>
                      {boundHardwareCount > 0 && (
                        <p className="artifact-status">
                          本节点已引用 {boundHardwareCount}{" "}
                          种真实硬件；同一板件的不同功能不重复计数，尚不代表完整BOM。
                        </p>
                      )}
                      <div className="hardware-options">
                        {hardwareCandidates.map((item) => (
                          <article key={item.id} className="hardware-option">
                            <span className="eyebrow">{item.kind}</span>
                            <span className="artifact-status">
                              {item.properties.libraryBinding ===
                              "source_referenced_proposal"
                                ? "已引用本地硬件资料 · 系统兼容性待核对"
                                : "模型提案 · 尚未绑定真实硬件记录"}
                            </span>
                            <h3>{item.label}</h3>
                            <Value value={item.properties} />
                          </article>
                        ))}
                      </div>
                      {hardwareCandidates.length === 0 && (
                        <p className="preview-placeholder">
                          尚未返回硬件候选方案。
                        </p>
                      )}
                    </>
                  )}
                  {node?.role === "designer" &&
                    (packet || imageAssets.length > 0) && (
                      <>
                        {[
                          {
                            key: "appearance_geometry",
                            title: "统一外形 · 几何一致三视图与轴测图",
                            note: "同一外观CAD、固定正交相机，不显示内部主板",
                          },
                          {
                            key: "appearance",
                            title: "造型参考 · 概念图片",
                            note: "独立生图不保证几何一致，不能用作工程三视图",
                          },
                          {
                            key: "component_layout",
                            title: "零件布置 · 轮廓三视图",
                            note: "只表达形状与位置；新结果使用统一CAD外形，历史结果可能仅有包络",
                          },
                          {
                            key: "legacy",
                            title: "历史混合视图",
                            note: "旧版结果，未按两组要求拆分",
                          },
                        ].map((group) => {
                          const items = imageAssets.filter(
                            (i) =>
                              (i.properties.generationMethod ===
                              "appearance_geometry"
                                ? "appearance_geometry"
                                : i.properties.imageSet || "legacy") ===
                              group.key,
                          );
                          return (
                            items.length > 0 && (
                              <section
                                key={group.key}
                                className={`visual-group ${group.key}`}
                              >
                                <div className="section-caption">
                                  {group.title}
                                  <span>
                                    {group.key === "component_layout" &&
                                    items.every(
                                      (i) => i.properties.appearanceRef,
                                    )
                                      ? "真实外形与零件轮廓；棕色虚线为暂定预留"
                                      : group.note}
                                  </span>
                                </div>
                                <div className="image-assets">
                                  {items.map((i) => (
                                    <ImageAsset key={i.id} item={i} />
                                  ))}
                                </div>
                              </section>
                            )
                          );
                        })}
                        {packet?.data.structure
                          .filter(
                            (i) =>
                              i.kind === "appearance-model" &&
                              typeof i.properties.stepUrl === "string",
                          )
                          .map((i) => (
                            <a
                              key={i.id}
                              href={String(i.properties.stepUrl)}
                              download
                            >
                              下载统一外形 STEP（未完成装配分件）
                            </a>
                          ))}
                        {imageAssets.length === 0 && (
                          <div className="preview-placeholder">
                            <FileImage size={25} />
                            <p>尚无图像产物。外观结果以设计说明呈现。</p>
                          </div>
                        )}
                      </>
                    )}
                  {packet &&
                    channels.map((c) => {
                      const items = packet.data[c].filter(
                        (i) =>
                          i.kind !== "coordination-decision" &&
                          i.kind !== "question-card" &&
                          i.kind !== "bom-baseline" &&
                          !(
                            node?.role === "embedded" && candidateIds.has(i.id)
                          ) &&
                          !(node?.role === "designer" && imageIds.has(i.id)),
                      );
                      return (
                        items.length > 0 && (
                          <section className="work-data-section" key={c}>
                            <h4>{channelNames[c]}</h4>
                            {items.map((i) => (
                              <article className="work-data-item" key={i.id}>
                                <h3>{i.label}</h3>
                                {typeof i.properties.code === "string" ? (
                                  <pre>{i.properties.code}</pre>
                                ) : (
                                  <Value value={i.properties} />
                                )}
                              </article>
                            ))}
                          </section>
                        )
                      );
                    })}
                </>
              )}
            </div>
          )}
          {project.phase === "blocked" && (
            <div className="workspace-blocked">
              <strong>产品经理暂停推进</strong>
              <p>{project.error}</p>
              <span>在下方提交补充要求或能力信息，由产品经理重新安排。</span>
              {!confirmGap ? (
                <button onClick={() => setConfirmGap(true)}>
                  带着这些缺口继续
                </button>
              ) : (
                <div>
                  <p>缺口会保留在后续结果中，继续进行可做的概念工作。</p>
                  <button
                    disabled={pending || !project.error}
                    onClick={() => {
                      setConfirmGap(false);
                      continueWithGaps(project.id, project.error!);
                    }}
                  >
                    确认继续
                  </button>
                  <button onClick={() => setConfirmGap(false)}>取消</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <div className="work-preview-footer">
        <span className="live-dot" />
        {questioning
          ? "你的选择会回到产品经理"
          : node?.role === "mechanical"
            ? "仅结构阶段使用 3D 视窗"
            : "按阶段呈现当前工作与产物"}
        <span>{node ? roleNames[node.role] : "等待输入"}</span>
      </div>
    </section>
  );
}
