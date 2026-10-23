import { lazy, Suspense, useState, useEffect, type ReactNode } from "react";
import {
  ArrowRight,
  Box,
  ExternalLink,
  FileText,
  GitBranch,
  Layers3,
  MessageSquare,
  PanelRightClose,
} from "lucide-react";
import type { Part, StageId } from "../../../../packages/core/src/contracts";
import {
  requirementOutputs,
  functionOutputs,
} from "../../../../packages/core/src/product-flow-data";
import type { ProjectView } from "../api";
import type { ProductNode, ProductEdge } from "../product-graph";
import { t } from "../i18n";
import { MarkdownMessage } from "./MarkdownMessage";
import { LocalLibrary } from "./LocalLibrary";
import { workflowExcerpt, workflowState } from "../workflow";
const ModelViewer = lazy(() =>
  import("./ModelViewer").then((m) => ({ default: m.ModelViewer })),
);
export type PreviewMode =
  | "cards"
  | "relations"
  | "hardware"
  | "model"
  | "library";

function sourceURL(source: string) {
  try {
    const url = new URL(source);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function ProductPreview({
  project,
  node,
  edge,
  port,
  catalog,
  mode,
  onMode,
  actions,
  onDetails,
  onConversation,
  onClose,
  onStage,
}: {
  project: ProjectView;
  node?: ProductNode;
  edge?: ProductEdge;
  port?: string;
  catalog: Part[];
  mode: PreviewMode;
  onMode: (mode: PreviewMode) => void;
  actions: ReactNode;
  onDetails: () => void;
  onConversation: () => void;
  onClose: () => void;
  onStage: (stage: StageId) => void;
}) {
  const stage = node?.data.stage;
  const current = stage ? project.stages[stage] : undefined;
  const requirements = requirementOutputs(project),
    functions = functionOutputs(project);
  const route = project.flowRoutingCurrent
    ? project.productFlow?.routing
    : undefined;
  const [chosenPart, setChosenPart] = useState("");
  useEffect(() => setChosenPart(""), [node?.id, edge?.id]);
  const partId =
    chosenPart ||
    node?.data.partId ||
    edge?.data?.partId ||
    project.stages.hardware.draft?.partIds[0];
  const part = catalog.find((p) => p.id === partId);
  const selectedReq = port?.startsWith("req:") ? port.slice(4) : undefined;
  const selectedFunction = port?.startsWith("fn:")
    ? port.slice(3)
    : port?.startsWith("route:")
      ? port.slice(6)
      : edge?.data?.functionId;
  const showActions =
    !edge &&
    node?.data.kind !== "proposal" &&
    !!stage &&
    ["requirements", "intent", "hardware"].includes(stage);
  const actualCAD = project.stages.cad.artifacts.filter((a) =>
    /\.(stl|glb|gltf)$/i.test(a.name),
  );
  const cards =
    stage === "requirements"
      ? requirements.filter((r) => !selectedReq || r.id === selectedReq)
      : [];
  const modules =
    stage === "intent"
      ? functions.filter((f) => !selectedFunction || f.id === selectedFunction)
      : [];
  return (
    <aside className="product-preview" aria-label={t("结果预览")}>
      <header className="product-preview-header">
        <div>
          <span className="eyebrow">PREVIEW</span>
          <h2>{t("结果预览")}</h2>
        </div>
        <button aria-label={t("收起预览")} onClick={onClose}>
          <PanelRightClose size={17} />
        </button>
      </header>
      <div
        className="product-preview-tabs"
        role="group"
        aria-label={t("预览类型")}
      >
        {(
          [
            ["cards", "卡片", FileText],
            ["relations", "连接", GitBranch],
            ["hardware", "器件", Layers3],
            ["model", "模型", Box],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            aria-pressed={mode === key}
            onClick={() => onMode(key)}
          >
            <Icon size={13} />
            {t(label)}
          </button>
        ))}
      </div>
      <div className="product-preview-scroll">
        {mode === "library" ? (
          <LocalLibrary projectId={project.id} />
        ) : mode === "model" ? (
          <>
            <h3>{t("CAD 模型预览")}</h3>
            {actualCAD.length ? (
              <Suspense fallback={<p>{t("加载 3D 预览…")}</p>}>
                <ModelViewer
                  parameters={project.parameters}
                  artifacts={actualCAD}
                  projectId={project.id}
                />
              </Suspense>
            ) : (
              <div className="product-preview-empty">
                <Box size={32} />
                <h3>{t("还没有 CAD 模型")}</h3>
                <p>
                  {t("模型生成后会在这里预览；当前不把默认外壳当成产品结果。")}
                </p>
              </div>
            )}
            <button
              onClick={() => {
                onStage("cad");
                onDetails();
              }}
            >
              {t("查看 CAD 阶段")}
              <ArrowRight size={13} />
            </button>
          </>
        ) : mode === "hardware" ? (
          <>
            <h3>{t("硬件与来源预览")}</h3>
            {!!project.stages.hardware.draft?.partIds.length && (
              <label className="product-part-picker">
                {t("选择器件")}
                <select
                  aria-label={t("选择器件")}
                  value={partId ?? ""}
                  onChange={(e) => setChosenPart(e.target.value)}
                >
                  {project.stages.hardware.draft.partIds.map((id) => (
                    <option key={id} value={id}>
                      {catalog.find((p) => p.id === id)?.name ?? id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {part ? (
              <article className="product-evidence">
                <span className="product-chip">{t("项目器件")}</span>
                <h3>{part.name}</h3>
                <p>
                  {part.manufacturer} · {part.revision}
                </p>
                <dl>
                  <dt>{t("工作电压")}</dt>
                  <dd>{part.voltage}</dd>
                  <dt>{t("接口")}</dt>
                  <dd>{part.interfaces.join(" / ") || "—"}</dd>
                  <dt>{t("目录尺寸")}</dt>
                  <dd>
                    {part.dimensions.width} × {part.dimensions.depth} ×{" "}
                    {part.dimensions.height ?? "?"} mm
                  </dd>
                  <dt>{t("安装几何")}</dt>
                  <dd>{t(part.geometryVerified ? "已核验" : "未核验")}</dd>
                </dl>
                <MarkdownMessage text={part.notes} card />
                {sourceURL(part.source) && (
                  <a
                    className="button"
                    href={sourceURL(part.source)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("打开商品 / 官方来源")}
                    <ExternalLink size={13} />
                  </a>
                )}
                {part.libraryRef && (
                  <details className="product-technical">
                    <summary>{t("来源版本")}</summary>
                    <p>
                      candidateId: <code>{part.libraryRef.candidateId}</code>
                    </p>
                    <p>
                      rawHash: <code>{part.libraryRef.rawHash}</code>
                    </p>
                    <p>
                      {t("这是当前项目引用的证据版本，库更新不会自动覆盖它。")}
                    </p>
                  </details>
                )}
                <h4>{t("回应的功能")}</h4>
                {route?.links
                  .filter((link) => link.partId === part.id)
                  .map((link) => (
                    <div className="product-relation" key={link.functionId}>
                      <strong>
                        {functions.find((f) => f.id === link.functionId)
                          ?.name ?? link.functionId}
                      </strong>
                      <span>{link.role}</span>
                      <p>{link.reason}</p>
                    </div>
                  ))}
                {!route && (
                  <p className="muted">
                    {t("统筹者尚未记录当前版本的功能连接。")}
                  </p>
                )}
              </article>
            ) : (
              <div className="product-preview-empty">
                <Layers3 size={30} />
                <p>
                  {t("尚未选定器件。可以先浏览资料库，再由硬件智能体选型。")}
                </p>
              </div>
            )}
            <button
              className="product-library-button"
              onClick={() => onMode("library")}
            >
              {t("浏览实时元件资料库")}
              <ArrowRight size={13} />
            </button>
          </>
        ) : mode === "relations" ? (
          <>
            <h3>{t("统筹者维护的连接")}</h3>
            {edge && (
              <article className="product-relation">
                <span className="product-chip">
                  {t(
                    edge.data?.kind === "request"
                      ? "上游补充请求"
                      : edge.data?.kind === "proposal"
                        ? "拟议连接"
                        : "数据连接",
                  )}
                </span>
                <p>
                  {edge.source} → {edge.target}
                </p>
                {edge.data?.reason && (
                  <MarkdownMessage text={edge.data.reason} card />
                )}
              </article>
            )}
            {route ? (
              <>
                <p className="product-muted">{route.description}</p>
                <div className="product-routing-summary">
                  {functions.length} {t("个功能")} ·{" "}
                  {project.stages.hardware.draft?.partIds.length ?? 0}{" "}
                  {t("个器件")} · {route.links.length} {t("条连接")}
                </div>
                {functions.map((f) => (
                  <article
                    className={`product-function-card ${selectedFunction === f.id ? "is-active" : ""}`}
                    key={f.id}
                  >
                    <span className="product-chip">{t("功能输出")}</span>
                    <h3>{f.name}</h3>
                    {route.links
                      .filter((link) => link.functionId === f.id)
                      .map((link) => (
                        <div className="product-relation" key={link.partId}>
                          <strong>
                            →{" "}
                            {catalog.find((p) => p.id === link.partId)?.name ??
                              link.partId}
                          </strong>
                          <span>{link.role}</span>
                          <p>{link.reason}</p>
                        </div>
                      ))}
                    {route.exceptions
                      .filter((ex) => ex.functionId === f.id)
                      .map((ex) => (
                        <p key={ex.functionId}>
                          {t(
                            ex.kind === "software" ? "纯软件实现" : "尚未落实",
                          )}
                          ：{ex.reason}
                        </p>
                      ))}
                  </article>
                ))}
              </>
            ) : (
              <div className="product-preview-empty">
                <GitBranch size={30} />
                <h3>{t("还没有有效的多对多连接")}</h3>
                <p>
                  {t(
                    "需要功能模块与器件候选，再由统筹者保存连接。不会根据名称自动猜配。",
                  )}
                </p>
                {project.productFlow?.routing && (
                  <p>{t("已有旧版本连接；上游已变化，等待重新统筹。")}</p>
                )}
              </div>
            )}
            {project.productFlow?.requests
              .filter((r) => r.status === "open")
              .map((request) => (
                <article className="product-request" key={request.id}>
                  <h4>{t("返回上游补充")}</h4>
                  <p>
                    {request.from} → {request.target}
                  </p>
                  <MarkdownMessage text={request.reason} card />
                  <ul>
                    {request.needed.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                  <button onClick={() => onStage(request.target)}>
                    {t("查看需要补充的节点")}
                    <ArrowRight size={13} />
                  </button>
                </article>
              ))}
            <p className="product-muted">
              {t("连线解释功能分工，不等于几何、电气或实物验证。")}
            </p>
          </>
        ) : (
          <>
            {node?.data.kind === "raw" ? (
              <>
                <span className="product-chip">{t("流程的第一个输入")}</span>
                <h3>{t("用户原始需求")}</h3>
                <article className="product-text-card">
                  <MarkdownMessage text={project.brief} card />
                </article>
                <p className="product-muted">
                  {t("它进入需求分析节点；澄清后的需求卡才是下游输入。")}
                </p>
                <button onClick={onConversation}>
                  <MessageSquare size={14} />
                  {t("补充原始想法")}
                </button>
              </>
            ) : node?.data.kind === "proposal" ? (
              <>
                <span className="product-chip">
                  {t("后续分工草案 · 待确认")}
                </span>
                <h3>{node.data.title}</h3>
                <p>{node.data.description}</p>
                <h4>{t("拟议输入")}</h4>
                {node.data.inputs.map((p) => (
                  <div className="product-port-preview" key={p.id}>
                    ○ {p.label}
                  </div>
                ))}
                <h4>{t("拟议输出")}</h4>
                {node.data.outputs.map((p) => (
                  <div className="product-port-preview" key={p.id}>
                    ● {p.label}
                  </div>
                ))}
                <p className="product-muted">
                  {t("这部分只草拟节点职责与连接，尚未接入本次新工作流。")}
                </p>
              </>
            ) : (
              <>
                <span className="product-chip">{node?.data.subtitle}</span>
                <h3>{node?.data.title}</h3>
                {cards.map((card) => (
                  <article className="product-text-card" key={card.id}>
                    <span className="product-card-id">{card.id}</span>
                    <h3>{card.title}</h3>
                    <MarkdownMessage text={card.description} card />
                    {!!card.acceptance.length && (
                      <>
                        <h4>{t("验收条件")}</h4>
                        <ul>
                          {card.acceptance.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </article>
                ))}
                {stage === "requirements" &&
                  current?.draft &&
                  !current.draft.requirementCards && (
                    <p className="product-muted">
                      {t(
                        "旧版需求以原文摘要作为一个输出端口，未自动改写原结果。",
                      )}
                    </p>
                  )}
                {modules.map((f) => (
                  <article className="product-function-card" key={f.id}>
                    <span className="product-card-id">{f.id}</span>
                    <h3>{f.name}</h3>
                    <MarkdownMessage text={f.description} card />
                    <div className="product-io">
                      <div>
                        <h4>{t("输入")}</h4>
                        {f.inputs.map((item, i) => (
                          <p key={i}>○ {item}</p>
                        ))}
                      </div>
                      <div>
                        <h4>{t("输出")}</h4>
                        {f.outputs.map((item, i) => (
                          <p key={i}>● {item}</p>
                        ))}
                      </div>
                    </div>
                    <h4>{t("验收条件")}</h4>
                    <ul>
                      {f.acceptance.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                    <details className="product-technical">
                      <summary>{t("需求来源与实现类型")}</summary>
                      <p>
                        {f.requirementIds.join(", ")} · {f.implementation}
                      </p>
                    </details>
                  </article>
                ))}
                {stage === "intent" && !functions.length && current?.draft && (
                  <div className="product-request">
                    <h4>{t("旧版结果还没有结构化功能模块")}</h4>
                    <p>
                      {t(
                        "保留原文，不把文字事实伪装成功能输出。重新执行意图阶段后，会生成独立的功能端口。",
                      )}
                    </p>
                    <details>
                      <summary>{t("查看原结果")}</summary>
                      <MarkdownMessage text={current.draft.summary} card />
                    </details>
                  </div>
                )}
                {stage === "hardware" && (
                  <>
                    <p>
                      {current?.draft
                        ? workflowExcerpt(current.draft.summary, 220)
                        : t(
                            "硬件节点接收所有功能输出，检索来源并组合候选器件。",
                          )}
                    </p>
                    <button
                      onClick={() =>
                        onMode(
                          node?.data.kind === "manager"
                            ? "relations"
                            : "hardware",
                        )
                      }
                    >
                      {t(
                        node?.data.kind === "manager"
                          ? "查看多对多连接"
                          : "预览器件与来源",
                      )}
                      <ArrowRight size={13} />
                    </button>
                  </>
                )}
                {!current?.draft && stage && (
                  <div className="product-preview-empty">
                    <p>{t(workflowState(project, stage).label)}</p>
                    <p>{node?.data.description}</p>
                  </div>
                )}
                {current?.draft && (
                  <details className="product-full-text">
                    <summary>{t("完整阶段说明与事实")}</summary>
                    <MarkdownMessage text={current.draft.summary} card />
                    {current.draft.facts.map((f, i) => (
                      <div key={i}>
                        <h4>{f.label}</h4>
                        <MarkdownMessage text={f.value} card />
                      </div>
                    ))}
                  </details>
                )}
                {!!current?.draft?.blockers.length && (
                  <details className="product-request">
                    <summary>
                      {t("当前阻塞")} · {current.draft.blockers.length}
                    </summary>
                    {current.draft.blockers.map((b, i) => (
                      <MarkdownMessage key={i} text={b} card />
                    ))}
                  </details>
                )}
              </>
            )}
          </>
        )}
        {showActions && (
          <section
            className="workflow-actions product-actions"
            aria-label={t("当前节点操作")}
          >
            {actions}
          </section>
        )}
        {showActions && (
          <button className="product-details-link" onClick={onDetails}>
            {t("打开完整阶段详情")}
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </aside>
  );
}
