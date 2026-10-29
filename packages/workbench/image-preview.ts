import {
  channels,
  type Invocation,
  type Project,
  type Packet,
} from "./contracts";

export function inheritedImagePackets(
  project: Project | undefined,
  node: Invocation | undefined,
) {
  const packets: Packet[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const parent = project?.nodes.find((n) => n.id === id);
    if (!parent || parent.role === "coordinator") return;
    parent.inputs.forEach(visit);
    packets.push(...(parent.imageEvidence || []));
    if (parent.packet?.data.structure.some((i) => i.kind === "generated-image"))
      packets.push(parent.packet);
  };
  node?.inputs.forEach(visit);
  // Completed geometry projections remain valid even if the model response failed.
  const index = project?.nodes.findIndex((n) => n.id === node?.id) ?? -1;
  for (const observed of project?.nodes.slice(0, index + 1) || []) {
    for (const proof of observed.imageEvidence || []) {
      if (
        proof.data.structure.some(
          (i) =>
            i.properties.imageSet === "component_layout" &&
            seen.has(String(i.properties.layoutSourceInvocationId)),
        )
      )
        packets.push(proof);
    }
  }
  return packets;
}

function imageKey(i: Packet["data"]["structure"][number]) {
  const group = i.properties.imageSet || "legacy";
  return `${group}/${i.properties.generationMethod === "appearance_geometry" ? "geometry/" : ""}${i.properties.view}`;
}

export function imagePreviewItems(node?: Invocation, inherited: Packet[] = []) {
  const candidates = [
    ...new Map(
      [
        ...inherited,
        ...(node?.packet ? [node.packet] : []),
        ...(node?.imageEvidence || []),
      ]
        .flatMap((p) => channels.flatMap((c) => p.data[c]))
        .filter(
          (i) =>
            i.kind.includes("image") ||
            i.kind.includes("view") ||
            i.properties.prompt ||
            i.properties.imageUrl,
        )
        .map((i) => [i.id, i]),
    ).values(),
  ];
  const generated = candidates.filter((i) => i.kind === "generated-image");
  const latest = new Map(generated.map((i) => [imageKey(i), i.id]));
  const actualIds = new Set(generated.map((i) => i.id));
  const actualViews = new Set(generated.map((i) => imageKey(i)));
  return {
    ids: new Set(candidates.map((i) => i.id)),
    items: candidates.filter(
      (i) =>
        (i.kind === "generated-image" && latest.get(imageKey(i)) === i.id) ||
        (i.kind !== "generated-image" &&
          !actualIds.has(String(i.properties.toolItemId)) &&
          !(i.kind === "image-request" && actualViews.has(imageKey(i)))),
    ),
  };
}
