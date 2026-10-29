import type { Packet } from "./contracts";

/** A layout is a complete retained assembly, not just the component last edited. */
export function layoutCoverageGaps(packet: Packet, inputs: Packet[]) {
  const body = packet.data.structure.find(
    (i) => i.kind !== "appearance-model" && i.properties.appearanceRef,
  );
  if (!body) return [];
  const ref = JSON.stringify(body.properties.appearanceRef);
  const expected = new Map<string, { label: string; count: number }>();
  const entries = (p: Packet) => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const i of p.data.structure) {
      const g = i.properties.geometryRef as
        | { source: string; recordId: string; assetId: string }
        | undefined;
      const key =
        g && i.kind === "component-instance"
          ? `part:${g.source}/${g.recordId}/${g.assetId}`
          : i.kind === "reserved-volume"
            ? `reserve:${String(i.properties.reservationKey || i.id.replace(/-v\d+$/, ""))}`
            : undefined;
      if (key)
        counts.set(key, {
          label: i.label,
          count: (counts.get(key)?.count || 0) + 1,
        });
    }
    return counts;
  };
  for (const p of inputs) {
    if (
      !p.data.structure.some(
        (i) =>
          i.kind !== "appearance-model" &&
          JSON.stringify(i.properties.appearanceRef) === ref,
      )
    )
      continue;
    for (const [key, row] of entries(p))
      if (row.count > (expected.get(key)?.count || 0)) expected.set(key, row);
  }
  const actual = entries(packet);
  return [...expected]
    .filter(([key, row]) => (actual.get(key)?.count || 0) < row.count)
    .map(
      ([, row]) => `完整结构快照缺少保留实例：${row.label}（应有${row.count}）`,
    );
}
