import type { Invocation } from "./contracts";

/** Coordinator inputs are observations, never transitive engineering dependencies. */
export function engineeringDependencies(ids: string[], nodes: Invocation[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const visit = (id: string) => {
    const node = byId.get(id);
    if (!node || seen.has(id)) return;
    seen.add(id);
    if (node.role === "coordinator" || node.status !== "done") return;
    node.inputs.forEach(visit);
  };
  ids.forEach(visit);
  return nodes.filter(
    (node) =>
      seen.has(node.id) &&
      node.status === "done" &&
      node.role !== "coordinator",
  );
}
