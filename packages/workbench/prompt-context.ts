import { channels, type Packet, type Role } from "./contracts";

export function compactHardwareRecord(properties: Record<string, unknown>) {
  const out = { ...properties };
  // All roles can retrieve full records on demand; large catalogs otherwise
  // multiply across dependencies even for a focused hardware task.
  const textLimit = 300;
  if (typeof out.sourceText === "string" && out.sourceText.length > textLimit)
    out.sourceText =
      out.sourceText.slice(0, textLimit) +
      "…（余下内容通过hardware_get或hardware_document读取）";
  const parameterLimit = 3000;
  if (
    Array.isArray(out.parameters) &&
    JSON.stringify(out.parameters).length > parameterLimit
  ) {
    const selected: unknown[] = [];
    for (const parameter of out.parameters) {
      if (selected.length >= 12) break;
      if (
        JSON.stringify(parameter).length < 1200 &&
        JSON.stringify([...selected, parameter]).length < parameterLimit
      )
        selected.push(parameter);
    }
    out.parameters = selected;
    out.parametersOmitted = true;
  }
  const assetLimit = 4;
  if (Array.isArray(out.assets) && out.assets.length > assetLimit) {
    out.assets = out.assets.slice(0, assetLimit);
    out.assetsOmitted = true;
  }
  const documentLimit = 3;
  if (Array.isArray(out.documents) && out.documents.length > documentLimit) {
    out.documents = out.documents.slice(0, documentLimit);
    out.documentsOmitted = true;
  }
  if (Array.isArray(out.documentExcerpts)) {
    out.documentExcerpts = out.documentExcerpts.map((e: any) => ({
      id: e.id,
      title: e.title,
      offset: e.offset,
      totalCharacters: e.totalCharacters,
      textSha256: e.textSha256,
    }));
    out.documentTextOmitted = true;
  }
  return out;
}

function coordinatorCodeView(value: unknown, path = ""): unknown {
  if (
    typeof value === "string" &&
    value.length > 800 &&
    /code|script|content|source|python|markdown/i.test(path)
  )
    return (
      value.slice(0, 200) +
      `…（统筹视图省略${value.length - 200}字符代码；完整产物保存在该条目中，专家依赖仍可读取）`
    );
  if (Array.isArray(value))
    return value.map((v) => coordinatorCodeView(v, path));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        coordinatorCodeView(v, `${path}.${key}`),
      ]),
    );
  return value;
}

function indexEngineeringResult(
  item: Packet["data"]["logic"][number],
  invocationId: string,
) {
  if (
    JSON.stringify(item.properties).length <= 650 ||
    /^(?:requirement|user-|question-card|review-finding|bom-baseline|hardware-option|hardware-record|hardware-geometry|appearance-design|generated-image)/.test(
      item.kind,
    )
  )
    return item;
  const keys = [
    "geometryFrame",
    "dimensionsMm",
    "positionMm",
    "rotationDeg",
    "geometryRef",
    "appearanceRef",
    "geometryDigest",
    "meshUrl",
    "stepUrl",
    "bodyBounds",
    "hardwareRefs",
    "status",
    "contractVersion",
    "firmwareVersion",
    "language",
    "interface",
    "signals",
    "supplyV",
    "compiled",
    "executed",
    "physicalVerified",
    "assemblyVerified",
    "geometryChecksPassed",
    "gaps",
    "printed",
    "designAssumption",
    "designAssumptions",
    "unverified",
    "unknownFields",
    "verification",
    "assumptions",
    "supersedes",
    "libraryBinding",
  ];
  return {
    ...item,
    properties: {
      ...Object.fromEntries(
        keys
          .filter(
            (key) =>
              item.properties[key] !== undefined &&
              JSON.stringify(item.properties[key]).length <= 2000,
          )
          .map((key) => [key, item.properties[key]]),
      ),
      contextView: "工程结果索引，省略细节不代表已经验证或可以忽略缺口",
      propertyKeys: Object.keys(item.properties),
      fullResult: {
        tool: "workbench_read_result",
        itemId: item.id,
        invocationId,
      },
    },
  };
}

/** A model view, not a persisted protocol packet. Keep facts and versions, omit transport history. */
export function promptPackets(
  packets: Packet[],
  role?: Role,
  indexOnly = false,
) {
  const latestImageByView = new Map<string, string>();
  const imageKey = (i: Packet["data"]["structure"][number]) =>
    `${i.properties.imageSet || "legacy"}/${i.properties.generationMethod || "image_model"}/${i.properties.view}`;
  if (role === "coordinator")
    for (const packet of packets)
      for (const item of packet.data.structure)
        if (item.kind === "generated-image")
          latestImageByView.set(imageKey(item), item.id);
  const seenEvidence = new Set<string>();
  const seenImages = new Set<string>();
  let baselineIndex = -1;
  let structureIndex = -1;
  let decisionIndex = -1;
  packets.forEach((p, index) => {
    if (p.data.logic.some((i) => i.kind === "coordination-decision"))
      decisionIndex = index;
    if (channels.some((c) => p.data[c].some((i) => i.kind === "bom-baseline")))
      baselineIndex = index;
    if (
      p.data.structure.some(
        (i) => i.kind === "component-instance" && i.properties.geometryRef,
      )
    )
      structureIndex = index;
  });
  const retainedIds = new Set<string>();
  const itemById = new Map(
    packets
      .flatMap((p) => channels.flatMap((c) => p.data[c]))
      .map((i) => [i.id, i]),
  );
  const retain = (id: string) => {
    if (retainedIds.has(id)) return;
    retainedIds.add(id);
    itemById.get(id)?.references.forEach(retain);
  };
  if (baselineIndex >= 0) {
    packets
      .slice(baselineIndex)
      .flatMap((p) => channels.flatMap((c) => p.data[c]))
      .forEach((i) => retain(i.id));
  }
  const view = packets.map(
    ({ inputs: _transportInputs, ...packet }, index) => ({
      ...packet,
      ...(role === "coordinator" ? { execution: undefined } : {}),
      summary:
        role === "coordinator" &&
        packet.invocationId === "user" &&
        channels.some((c) => packet.data[c].length)
          ? "用户输入全文见数据条目"
          : indexOnly &&
              role === "coordinator" &&
              packet.invocationId !== "user" &&
              index < packets.length - 8
            ? "历史结果全文按条目读取"
            : role === "coordinator" &&
                ["hardware-library", "image-generation"].includes(
                  packet.invocationId,
                )
              ? "工具证据见条目"
              : role === "coordinator" &&
                  index < baselineIndex &&
                  packet.summary.length > 240
                ? packet.summary.slice(0, 240) + "…（历史全文见调用详情）"
                : packet.summary,
      data: Object.fromEntries(
        channels.map((channel) => [
          channel,
          packet.data[channel]
            .filter((item) => {
              // Dispatch history already exists as invocation states and per-packet summaries.
              if (item.kind === "coordination-decision") return false;
              if (
                role &&
                index < structureIndex &&
                [
                  "component-instance",
                  "enclosure-proposal",
                  "reserved-volume",
                  "opening-proposal",
                  "assembly-sequence",
                  "motion-concept",
                  "path-concept",
                ].includes(item.kind)
              )
                return false;
              if (item.kind === "generated-image") {
                if (
                  role === "coordinator" &&
                  latestImageByView.get(imageKey(item)) !== item.id
                )
                  return false;
                const key = JSON.stringify(item);
                if (seenImages.has(key)) return false;
                seenImages.add(key);
              }
              // A validated baseline is a current decision snapshot. The manager keeps older
              // result summaries, all user constraints/reviews and all newer engineering deltas.
              // Specialists still receive the complete versioned evidence and geometry.
              if (
                baselineIndex >= 0 &&
                index < baselineIndex &&
                !retainedIds.has(item.id) &&
                ![
                  "hardware-record",
                  "requirement",
                  "user-selection",
                  "user-feedback",
                  "review-finding",
                  "question-card",
                  "image-request",
                  "generated-image",
                  "appearance-design",
                  "appearance-model",
                  "user-gap-override",
                  "unresolved-gap",
                  "hardware-gap-diagnosis",
                ].includes(item.kind)
              )
                return false;
              if (
                item.kind !== "hardware-record" &&
                item.kind !== "hardware-geometry"
              )
                return true;
              const exact =
                role && item.kind === "hardware-record"
                  ? `${item.kind}:${item.id}:${item.properties.revision}`
                  : JSON.stringify(item);
              if (seenEvidence.has(exact)) return false;
              seenEvidence.add(exact);
              return true;
            })
            .map((item) =>
              role === "coordinator" && item.kind === "generated-image"
                ? {
                    ...item,
                    properties: Object.fromEntries(
                      [
                        "version",
                        "id",
                        "imageSet",
                        "projection",
                        "view",
                        "imageUrl",
                        "model",
                        "sha256",
                        "referenceAssetId",
                        "generationMethod",
                        "appearanceRef",
                        "geometryDigest",
                        "geometryConsistent",
                        "layoutSourceInvocationId",
                        "engineeringVerified",
                        "status",
                        "envelopeMm",
                      ].map((k) => [k, item.properties[k]]),
                    ),
                  }
                : role === "coordinator" && item.kind === "hardware-geometry"
                  ? {
                      ...item,
                      properties: Object.fromEntries(
                        [
                          "reference",
                          "assetId",
                          "sha256",
                          "coverage",
                          "dimensionsMm",
                          "units",
                          "coordinateFrame",
                          "evidence",
                          "solidCount",
                          "shapeValid",
                        ].map((k) => [k, item.properties[k]]),
                      ),
                    }
                  : (role === "coordinator" || indexOnly) &&
                      item.kind === "hardware-record"
                    ? {
                        ...item,
                        properties: Object.fromEntries(
                          [
                            "source",
                            "recordId",
                            "revision",
                            "itemId",
                            "title",
                            "evidence",
                            "assetCount",
                            "documentCount",
                            "physicalVerified",
                            "geometryVerified",
                            "url",
                          ].map((k) => [k, item.properties[k]]),
                        ),
                      }
                    : role && item.kind === "hardware-record"
                      ? {
                          ...item,
                          properties: compactHardwareRecord(item.properties),
                        }
                      : item,
            ),
        ]),
      ),
    }),
  );
  if (role === "coordinator" || (role && indexOnly)) {
    for (const packet of view)
      for (const channel of channels) {
        packet.data[channel] = packet.data[channel].map((item) =>
          indexOnly
            ? indexEngineeringResult(item, packet.invocationId)
            : /^(?:requirement|user-|question-card|review-finding|bom-baseline|hardware-option)/.test(
                  item.kind,
                )
              ? item
              : {
                  ...item,
                  properties: coordinatorCodeView(item.properties) as Record<
                    string,
                    unknown
                  >,
                },
        );
      }
  }
  return view.filter((packet, index) => {
    if (channels.some((c) => packet.data[c].length)) return true;
    if (
      indexOnly &&
      role &&
      packet.invocationId !== "user" &&
      index < view.length - 8
    )
      return false;
    if (
      role &&
      ["hardware-library", "image-generation"].includes(packet.invocationId)
    )
      return false;
    // The current baseline supersedes old scheduling transport; keep all user
    // constraints and engineering summaries, not every past dispatch packet.
    return !(
      role === "coordinator" &&
      index !== decisionIndex &&
      channels.some((c) =>
        packets[index].data[c].some((i) => i.kind === "coordination-decision"),
      )
    );
  });
}
