import { promptPackets } from "./prompt-context";
import type { Caller } from "./runtime";
import { channels, type Role } from "./contracts";

export function prepareModelPrompt(
  role: Role,
  input: Parameters<Caller>[1],
  limit = 98000,
) {
  const state = input.state && {
    ...input.state,
    invocations: input.state.invocations.map(
      ({ toolActivity, ...node }, index, all) => ({
        ...node,
        engineeringReport: node.engineeringReport && {
          ...node.engineeringReport,
          dependencyPacketIds: undefined,
          errorCount: node.engineeringReport.errors.length,
          gapCount: node.engineeringReport.gaps.length,
          errors: node.engineeringReport.errors.slice(0, 8),
          gaps: node.engineeringReport.gaps.slice(0, 8),
          fullReport:
            "调用详情保存完整诊断；此处最多展示各8项，不代表其余已解决",
        },
        error:
          node.error &&
          (node.error.length > (index >= all.length - 6 ? 900 : 180)
            ? node.error.slice(0, index >= all.length - 6 ? 900 : 180) +
              "…（完整错误见调用详情）"
            : node.error),
        toolActivityCount: toolActivity?.length || 0,
        toolSummary:
          index < all.length - 12
            ? undefined
            : {
                searches:
                  toolActivity?.filter(
                    (t) => t.tool === "hardware_search" && t.success,
                  ).length || 0,
                hits:
                  toolActivity?.filter(
                    (t) =>
                      t.tool === "hardware_search" &&
                      t.success &&
                      (t.total || 0) > 0,
                  ).length || 0,
                reads:
                  toolActivity?.filter(
                    (t) => t.tool === "hardware_get" && t.success,
                  ).length || 0,
                failures: toolActivity?.filter((t) => !t.success).length || 0,
                lastFailure: toolActivity
                  ?.filter((t) => !t.success)
                  .slice(-1)
                  .map((t) => ({
                    tool: t.tool,
                    error: t.error?.trim().split("\n").at(-1)?.slice(-1000),
                  }))[0],
              },
      }),
    ),
  };
  const render = (indexOnly: boolean, catalogOnly = false, slim = false) => {
    const packets = promptPackets(
      input.packets,
      catalogOnly ? "coordinator" : role,
      indexOnly,
    );
    if (catalogOnly)
      for (const packet of packets)
        for (const channel of channels)
          packet.data[channel] = packet.data[channel].map((item) => {
            if (
              /^(?:requirement|user-.*|question-card|bom-baseline)$/.test(
                item.kind,
              ) ||
              JSON.stringify(item.properties).length < 500
            )
              return item;
            const keys = [
              "version",
              "contractVersion",
              "geometryFrame",
              "appearanceRef",
              "geometryDigest",
              "dimensionsMm",
              "positionMm",
              "rotationDeg",
              "geometryRef",
              "hardwareRefs",
              "source",
              "recordId",
              "revision",
              "status",
              "compiled",
              "executed",
              "physicalVerified",
              "assemblyVerified",
              "geometryChecksPassed",
              "gaps",
              "printed",
              "engineeringVerified",
              "unverified",
              "unknownFields",
              "designAssumption",
              "view",
              "imageSet",
              "generationMethod",
              "layoutSourceInvocationId",
              "geometryConsistent",
              "severity",
              "title",
              "itemId",
              "evidence",
              "bomVersion",
              "function",
              "partNumber",
              "manufacturer",
              "quantity",
              "unit",
              "scope",
              "selectionStatus",
              "required",
              "interfaces",
              "layoutFit",
            ];
            const properties = {
              ...Object.fromEntries(
                keys
                  .filter((k) => item.properties[k] !== undefined)
                  .map((k) => [k, item.properties[k]]),
              ),
              fullResult: {
                tool: "workbench_read_result",
                itemId: item.id,
                invocationId: packet.invocationId,
              },
            } as Record<string, unknown>;
            if (properties.layoutFit) {
              const f = properties.layoutFit as {
                passed: boolean;
                parts: any[];
                scope: string;
              };
              properties.layoutFit = {
                passed: f.passed,
                parts: f.parts?.filter((p) => !p.passed),
                scope: f.scope,
              };
            }
            const candidate = {
              ...item,
              references: [],
              properties: {
                ...properties,
                contextView: "引用与参数全文见fullResult",
              },
            };
            return JSON.stringify(candidate).length <
              JSON.stringify(item).length
              ? candidate
              : item;
          });
    if (slim)
      for (const packet of packets) {
        if (packet.invocationId !== "user") packet.summary = "工程条目索引";
        for (const channel of channels)
          packet.data[channel] = packet.data[channel].map((item) => {
            if (
              /^(?:requirement|user-.*|question-card|bom-baseline)$/.test(
                item.kind,
              )
            )
              return item;
            const keys = [
              "version",
              "bomVersion",
              "contractVersion",
              "source",
              "recordId",
              "revision",
              "reference",
              "assetId",
              "sha256",
              "evidence",
              "geometryRef",
              "hardwareRefs",
              "appearanceRef",
              "geometryDigest",
              "dimensionsMm",
              "positionMm",
              "rotationDeg",
              "partNumber",
              "manufacturer",
              "quantity",
              "unit",
              "selectionStatus",
              "required",
              "physicalVerified",
              "assemblyVerified",
              "geometryChecksPassed",
              "gaps",
              "printed",
              "engineeringVerified",
              "compiled",
              "status",
              "severity",
              "designAssumption",
              "unknownFields",
              "unverified",
              "imageSet",
              "view",
              "generationMethod",
              "layoutSourceInvocationId",
            ];
            const properties: Record<string, unknown> = {
              ...Object.fromEntries(
                keys
                  .filter((k) => item.properties[k] !== undefined)
                  .map((k) => [k, item.properties[k]]),
              ),
              fullResult: {
                tool: "workbench_read_result",
                itemId: item.id,
                invocationId: packet.invocationId,
              },
            };
            if (item.properties.layoutFit) {
              const f = item.properties.layoutFit as {
                passed: boolean;
                scope: string;
                parts?: { id: string; passed: boolean }[];
              };
              properties.layoutFit = {
                passed: f.passed,
                scope: f.scope,
                failedParts: f.parts?.filter((p) => !p.passed).map((p) => p.id),
              };
            }
            return { ...item, references: [], properties };
          });
      }
    return JSON.stringify({
      ...input,
      state: state && {
        ...state,
        completedByRole:
          (role === "coordinator" || catalogOnly) && state.completedByRole
            ? Object.fromEntries(
                Object.entries(state.completedByRole).map(([r, ids]) => [
                  r,
                  ids.slice(r === "coordinator" ? -3 : -4),
                ]),
              )
            : state.completedByRole,
        completedRoleCounts: state.completedByRole
          ? Object.fromEntries(
              Object.entries(state.completedByRole).map(([r, ids]) => [
                r,
                ids.length,
              ]),
            )
          : undefined,
        invocations: (role === "coordinator" || catalogOnly
          ? state.invocations.filter(
              (n, index, all) =>
                n.role !== "coordinator" || index >= all.length - 6,
            )
          : state.invocations
        ).map((n, index, all) =>
          catalogOnly && index < all.length - 12
            ? { id: n.id, role: n.role, title: n.title, status: n.status }
            : n,
        ),
        itemIdsSource: catalogOnly
          ? "可引用ID为packets.data各通道条目的id，以及本次工具返回的itemId"
          : undefined,
        itemIds: catalogOnly
          ? undefined
          : [
              ...new Set(
                packets.flatMap((p) =>
                  channels.flatMap((c) => p.data[c].map((i) => i.id)),
                ),
              ),
            ],
      },
      packets,
    });
  };
  // Compact before the hard ceiling: a prompt barely under 98k leaves no room
  // for research results or protocol repair in Pi's session. Full packets stay
  // available through workbench_read_result, never rewritten by this view.
  const target = Math.min(limit, 32000);
  let prompt = render(false);
  for (const candidate of [
    () => render(true),
    () => render(true, true),
    () => render(true, true, true),
  ]) {
    if (prompt.length <= target) break;
    const next = candidate();
    if (next.length < prompt.length) prompt = next;
  }
  if (prompt.length > limit)
    throw new Error(
      `任务上下文超出安全预算（${prompt.length}字符，上限${limit}）；请缩小任务依赖或补充资料后继续`,
    );
  return prompt;
}
