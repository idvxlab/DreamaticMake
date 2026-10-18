import { stageLabels, roleForStage, type StageId } from "./contracts";
const short = (value: unknown, limit = 180) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, limit) : "";
export function describeToolObject(
  name: string,
  args: Record<string, unknown>,
  context: { projectName: string; stage: StageId; revision: number },
) {
  const stage = `${stageLabels[context.stage]} · V${context.revision}`,
    project = short(context.projectName, 80);
  switch (name) {
    case "context_read":
      return `${project} / 项目上下文（project.json：全部阶段、消息、审批；硬件目录、附件索引）/ 当前：${stage}`;
    case "agent_dispatch":
      return `${project} / ${stage} → ${roleForStage[context.stage]}`;
    case "ask_user":
      return `${project} / ${stage} / 问题卡：${short(args.title)}`;
    case "catalog_search":
      return `${project} / 本项目硬件目录 / 检索：${short(args.query) || "全部部件"}`;
    case "research_crawl":
    case "research_fetch": {
      try {
        if (!args.url && name === "research_crawl")
          return `${project} / 配置资料入口 / 检索：${short(args.query)}`;
        const url = new URL(String(args.url));
        return `${project} / 资料：${url.origin}${url.pathname}`;
      } catch {
        return `${project} / 资料地址无效`;
      }
    }
    case "catalog_add":
      return `${project} / 本项目硬件目录 / ${short(args.name)}（${short(args.id, 80)}）`;
    case "stage_submit":
      return `${project} / ${stage}草稿：${short(args.title)}`;
    case "review_submit":
      return `${project} / ${stage}草稿 / 审阅结论：${args.verdict === "pass" ? "通过" : "需修改"}`;
    case "text_to_cad": {
      const p = args.parameters as Record<string, unknown> | undefined;
      const dims = ["width", "depth", "height"]
        .map((k) => (typeof p?.[k] === "number" ? String(p[k]) : "?"))
        .join(" × ");
      return `${project} / ${stage} / 外壳 ${dims} mm → STEP、STL`;
    }
    case "image_to_cad":
      return `${project} / 图片附件 ${short(args.attachmentId, 80)} / 参考宽度 ${typeof args.referenceWidthMm === "number" ? args.referenceWidthMm : "?"} mm`;
    case "firmware_build":
      return `${project} / Raspberry Pi Pico / src/main.cpp、platformio.ini → 固件编译`;
    default:
      return `${project} / ${stage}`;
  }
}
export function toolActivityLabel(name: string, object?: string) {
  return `${name}：${object || "旧记录未保存操作对象"}`;
}
