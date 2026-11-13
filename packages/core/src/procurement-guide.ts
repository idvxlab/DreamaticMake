import type { PurchaseCandidate } from "../../design-engine/src/bridge";
import type { Project, StageRecord } from "./project";

const purchaseHeading = "### 购买链接";
const assemblyHeading = "\n\n## 装配说明\n\n";

export function purchaseSourceText(artifact: StageRecord["artifact"]) {
  if (!artifact) return "";
  return [artifact.markdown, JSON.stringify(artifact.structured?.deliverable ?? {})].join("\n");
}

export function withPurchaseLinks(markdown: string, candidates: PurchaseCandidate[]) {
  const insertAt = markdown.indexOf(assemblyHeading);
  if (insertAt < 0 || markdown.includes(`\n${purchaseHeading}\n`)) return markdown;
  const escapeCell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
  const rows = candidates.map(({ name, model, status, note, purchase_links }) => {
    const links = purchase_links.map(({ supplier, url }) => `[${escapeCell(supplier)}](<${url}>)`).join("、");
    return `| ${escapeCell(name)} | ${escapeCell(model)} | ${status} | ${links} | ${escapeCell(note) || "核对封装、规格及库存"} |`;
  });
  const table = rows.length ? [
    "| 元件 | 料号 | 状态 | 购买链接 | 下单前核对 |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n") : "当前上游选型中没有匹配到具体供应商料号。";
  const section = [
    purchaseHeading, table, "候选链接供选型和核价。其余物料待型号与规格确认后补充链接。",
  ].join("\n\n");
  return `${markdown.slice(0, insertAt)}\n\n${section}${markdown.slice(insertAt)}`;
}

export function historicalGuideSource(project: Project, guide: NonNullable<StageRecord["artifact"]>) {
  const expected = guide.structured?.upstream.hardware_selection;
  const hardware = project.stages.find(({ id }) => id === "hardware_selection")?.artifact;
  if (!expected || !hardware || expected.artifact_id !== hardware.pin.artifact_id ||
      expected.revision !== hardware.pin.revision || expected.content_hash !== hardware.pin.content_hash) return "";
  return purchaseSourceText(hardware);
}
