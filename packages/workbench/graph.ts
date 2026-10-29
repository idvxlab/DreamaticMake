import type { Invocation } from "./contracts";

export const designerStageNames = {
  effect: "效果图",
  appearance: "外观三视图",
  structure: "结构三视图",
} as const;
export type DesignerStage = keyof typeof designerStageNames;
export function designerStage(node: Invocation): DesignerStage | undefined {
  const items = [
    ...(node.imageEvidence || []),
    ...(node.packet ? [node.packet] : []),
  ].flatMap((p) => p.data.structure);
  const actual = items.filter((i) => i.kind === "generated-image");
  if (actual.some((i) => i.properties.imageSet === "component_layout"))
    return "structure";
  if (
    actual.some(
      (i) =>
        i.properties.imageSet === "appearance" &&
        i.properties.generationMethod === "appearance_geometry",
    )
  )
    return "appearance";
  if (actual.some((i) => i.properties.imageSet === "appearance"))
    return "effect";
  return;
}

/** Presentation only: original invocations and their inputs remain untouched. */
export function workflowOverview(
  nodes: Invocation[],
  expanded = false,
  reveal: string[] = [],
) {
  if (expanded) return { nodes, history: [] as Invocation[] };
  // Role is not a functional identity: independent teams may share a role.
  // Show every unconsumed successful branch, active task, and its direct inputs.
  // PM observations are intentionally excluded from engineering consumption.
  const consumed = new Set(
    nodes
      .filter((n) => n.role !== "coordinator" && n.status === "done")
      .flatMap((n) => n.inputs),
  );
  const successful = nodes.filter(
    (n) => n.role !== "coordinator" && n.status === "done",
  );
  const roots = nodes.filter(
    (n) =>
      n.role !== "coordinator" &&
      ((n.status === "done" && !consumed.has(n.id)) ||
        n.status === "running" ||
        n.status === "queued"),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = new Set(roots.map((n) => n.id));
  for (const root of [
    ...roots,
    ...nodes.filter((n) => reveal.includes(n.id)),
  ]) {
    ids.add(root.id);
    for (const id of root.inputs) {
      const parent = byId.get(id);
      if (parent && parent.role !== "coordinator") ids.add(id);
    }
  }
  // A completely failed exploration must not appear empty.
  if (!successful.length)
    for (const node of nodes) if (node.role !== "coordinator") ids.add(node.id);
  // Three artifact stages, never one arbitrary result per designer role.
  const stageResults = new Map<DesignerStage, Invocation>();
  for (const n of nodes)
    if (n.role === "designer") {
      const stage = designerStage(n);
      if (stage) stageResults.set(stage, n);
    }
  if (stageResults.size)
    for (const n of nodes) if (n.role === "designer") ids.delete(n.id);
  for (const n of stageResults.values()) ids.add(n.id);
  // Keep real analysis and key PM entry/handoff decisions in the main view.
  for (const n of nodes)
    if (n.role === "analyst" && n.status === "done") ids.add(n.id);
  const managers = nodes.filter((n) => n.role === "coordinator");
  for (const n of [managers[0], managers.at(-1)]) if (n) ids.add(n.id);
  for (const n of [
    ...stageResults.values(),
    ...nodes.filter((n) => n.role === "analyst" && ids.has(n.id)),
  ]) {
    const pm = n.inputs
      .map((id) => byId.get(id))
      .find((p) => p?.role === "coordinator");
    if (pm) ids.add(pm.id);
  }
  // Explicit per-card input expansion remains exact, including old designer versions.
  for (const id of reveal) {
    const n = byId.get(id);
    if (n) {
      ids.add(id);
      for (const parent of n.inputs) if (byId.has(parent)) ids.add(parent);
    }
  }
  return {
    nodes: nodes.filter((n) => ids.has(n.id)),
    history: nodes.filter((n) => !ids.has(n.id)),
  };
}

export function workflowLayout(
  nodes: Invocation[],
): Record<string, { x: number; y: number }> {
  const managers = nodes.filter((n) => n.role === "coordinator");
  const engineering = nodes.filter((n) => n.role !== "coordinator");
  const ids = new Set(engineering.map((n) => n.id));
  const engineeringTop = managers.length
    ? Math.ceil(managers.length / 6) * 175 + 45
    : 0;
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const level = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = byId
      .get(id)!
      .inputs.filter((p) => ids.has(p) && !visiting.has(p));
    const value = parents.length ? 1 + Math.max(...parents.map(level)) : 0;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  const counts = new Map<number, number>();
  for (const node of engineering) {
    const col = level(node.id);
    counts.set(col, (counts.get(col) || 0) + 1);
  }
  const starts = new Map<number, number>();
  let start = 0;
  for (const col of [...counts.keys()].sort((a, b) => a - b)) {
    starts.set(col, start);
    start += Math.ceil(counts.get(col)! / 4) * 290;
  }
  const rows = new Map<number, number>();
  return Object.fromEntries([
    ...managers.map(
      (n, i) =>
        [n.id, { x: (i % 6) * 290, y: Math.floor(i / 6) * 175 }] as const,
    ),
    ...engineering.map((n) => {
      const col = level(n.id),
        row = rows.get(col) || 0;
      rows.set(col, row + 1);
      return [
        n.id,
        {
          x: starts.get(col)! + Math.floor(row / 4) * 290,
          y: engineeringTop + (row % 4) * 175,
        },
      ] as const;
    }),
  ]);
}

export type WorkflowEdge = {
  from: string;
  to: string;
  kind: "dispatch" | "data" | "observation";
};

// Observation fan-in belongs in the invocation inspector, not every overview wire.
export function workflowEdges(
  nodes: Invocation[],
  all = false,
): WorkflowEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const reaches = (
    from: string,
    target: string,
    seen = new Set<string>(),
  ): boolean => {
    if (from === target) return true;
    const node = byId.get(from);
    if (!node || node.role === "coordinator" || seen.has(from)) return false;
    seen.add(from);
    return node.inputs.some((id) => reaches(id, target, seen));
  };
  return nodes.flatMap((node) => {
    const parents = [...new Set(node.inputs)].filter((id) => byId.has(id));
    if (!all && node.role === "coordinator") return [];
    return parents
      .filter(
        (id) =>
          all ||
          byId.get(id)!.role === "coordinator" ||
          !parents.some((other) => other !== id && reaches(other, id)),
      )
      .map((from) => ({
        from,
        to: node.id,
        kind:
          node.role === "coordinator"
            ? ("observation" as const)
            : byId.get(from)!.role === "coordinator"
              ? ("dispatch" as const)
              : ("data" as const),
      }));
  });
}
