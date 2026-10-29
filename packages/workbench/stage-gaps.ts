import { layoutCoverageGaps } from "./layout-coverage";
import { channels, type Invocation, type Task } from "./contracts";
import { visualTaskRequirements } from "./execution-evidence";
import { engineeringDependencies } from "./engineering-dependencies";

/** Assess only the results the proposed structural task actually consumes. */
export function stageGaps(task: Task, nodes: Invocation[], strict = false) {
  const projection =
    task.role === "designer" &&
    /轮廓|零件布置|render_component_views/i.test(
      visualTaskRequirements(task.instruction),
    );
  if (task.role !== "mechanical" && task.role !== "software" && !projection)
    return [];
  const ancestors = new Map(
    engineeringDependencies(task.dependsOn, nodes).map((node) => [
      node.id,
      node,
    ]),
  );
  const sourceItems = nodes
    .filter((n) => ancestors.has(n.id))
    .flatMap((n) => [
      ...(n.packet ? [n.packet] : []),
      ...(n.appearanceEvidence || []),
      ...(n.imageEvidence || []),
      ...(n.assemblyEvidence || []),
    ])
    .flatMap((p) => p.data.structure);
  if (
    task.role === "mechanical" &&
    task.instruction
      .split(/[。；;\n]/)
      .some(
        (clause) =>
          !/(?:不|无需|不必|禁止|不要|尚未).{0,6}(?:执行|调用)/.test(clause) &&
          /build_printable_assembly|执行.{0,12}(?:可打印|分件|装配CAD)/i.test(
            clause,
          ),
      )
  ) {
    const gaps: string[] = [];
    const design = [...sourceItems]
      .reverse()
      .find((i) => i.kind === "assembly-design");
    if (!design)
      gaps.push(
        "可打印装配执行缺少assembly-design提案：须明确逐件固定/接触依据、走线及连接器服务包络、分件装配维修与打印约束",
      );
    if (!sourceItems.some((i) => i.kind === "appearance-model"))
      gaps.push("可打印装配执行缺少来源绑定的真实外形模型");
    // Consume a complete single mechanical snapshot, never assemble a layout
    // from unrelated ancestors with one conveniently positioned component.
    const layout = [...ancestors.values()]
      .reverse()
      .find(
        (n) =>
          n.role === "mechanical" &&
          n.packet?.data.structure.some(
            (i) =>
              i.kind === "component-instance" || i.kind === "reserved-volume",
          ),
      )?.packet;
    const parts =
      layout?.data.structure.filter((i) => i.kind === "component-instance") ||
      [];
    const vector = (v: unknown) =>
      Array.isArray(v) &&
      v.length === 3 &&
      v.every((n) => typeof n === "number" && Number.isFinite(n));
    if (
      !parts.length ||
      parts.some(
        (i) =>
          !i.properties.geometryRef ||
          !vector(i.properties.positionMm ?? i.properties.translationMm) ||
          !vector(i.properties.rotationDeg),
      )
    )
      gaps.push("可打印装配执行缺少完整来源绑定的实际零件布局");
    if (layout?.data.structure.some((i) => i.kind === "reserved-volume"))
      gaps.push("可打印装配执行仍有假设预留体积：不能作为完整真实零件装配执行");
    if (design && parts.length) {
      const planned = design.properties.instances;
      const ids = Array.isArray(planned)
        ? planned
            .map((i) =>
              i && typeof i === "object"
                ? String((i as Record<string, unknown>).id)
                : "",
            )
            .sort()
        : [];
      if (JSON.stringify(ids) !== JSON.stringify(parts.map((i) => i.id).sort()))
        gaps.push(
          "assembly-design实例清单与实际完整布局不一致，请重新交接后执行",
        );
    }
    if (gaps.length) return gaps;
  }
  const canonical =
    strict ||
    sourceItems.some(
      (i) => i.kind === "appearance-design" || i.kind === "appearance-model",
    );
  const assemblyGaps: string[] = [];
  if (task.key === "finish") {
    const design = [...sourceItems]
      .reverse()
      .find((i) => i.kind === "assembly-design");
    if (design) {
      const evidence = [...ancestors.values()]
        .flatMap((n) => n.assemblyEvidence || [])
        .filter(
          (p) =>
            p.evidence === "executed" &&
            p.execution?.tool === "build_printable_assembly",
        )
        .flatMap((p) => p.data.structure)
        .filter(
          (i) =>
            i.kind === "assembly-model" &&
            i.properties.sourceItemId === design.id,
        )
        .at(-1);
      if (!evidence)
        assemblyGaps.push(
          "装配设计尚无对应build_printable_assembly真实执行证据",
        );
      else {
        const p = evidence.properties;
        const report = p.report as Record<string, unknown> | undefined;
        if (
          p.geometryChecksPassed !== true ||
          report?.geometryChecksPassed !== true
        )
          assemblyGaps.push(
            "装配分件几何检查尚未通过，不能以summary或产物存在判定合法",
          );
        const closure = report?.closure as Record<string, unknown> | undefined;
        if (closure?.provided !== true || closure.passed !== true)
          assemblyGaps.push(
            "装配闭合定位/紧固检查缺失或未通过，不能声称可回装",
          );
        if (!Array.isArray(report?.gaps))
          assemblyGaps.push("装配执行报告缺少未验证范围清单");
        else
          for (const gap of report.gaps)
            if (typeof gap === "string" && gap.trim())
              assemblyGaps.push(`装配未验证范围：${gap}`);
      }
    }
  }
  if (projection) {
    const ready = [...ancestors.values()].some((n) => {
      const parts = n.packet?.data.structure || [];
      return (
        parts.some(
          (i) => i.properties.geometryRef && i.properties.positionMm,
        ) &&
        parts.some(
          (i) =>
            !i.properties.geometryRef &&
            (!canonical || !!i.properties.appearanceRef) &&
            Array.isArray(i.properties.dimensionsMm) &&
            Array.isArray(i.properties.positionMm),
        )
      );
    });
    return ready
      ? []
      : [
          "零件轮廓图缺少已完成的结构布置：需要同一结果中的真实零件位置与外壳包络",
        ];
  }
  const prerequisites: string[] = [];
  if (task.key !== "finish") {
    if (task.role === "mechanical") {
      if (![...ancestors.values()].some((n) => n.role === "embedded"))
        prerequisites.push("缺少必要前置结果：硬件方案");
      if (![...ancestors.values()].some((n) => n.role === "designer"))
        prerequisites.push("缺少必要前置结果：外观方案");
    }
    if (
      task.role === "software" &&
      ![...ancestors.values()].some((n) => n.role === "mechanical")
    )
      prerequisites.push("缺少必要前置结果：结构方案");
  }
  if (task.role === "software") return prerequisites;
  const packets = nodes
    .filter((n) => ancestors.has(n.id))
    .flatMap((n) => [
      ...(n.packet ? [n.packet] : []),
      ...(n.hardwareEvidence || []),
      ...(n.imageEvidence || []),
      ...(n.appearanceEvidence || []),
      ...(n.assemblyEvidence || []),
    ]);
  const items = packets.flatMap((p) => channels.flatMap((c) => p.data[c]));
  const latestBaseline = [...nodes]
    .reverse()
    .filter((n) => ancestors.has(n.id))
    .flatMap((n) =>
      n.packet ? channels.flatMap((c) => n.packet!.data[c]) : [],
    )
    .find((i) => i.kind === "bom-baseline");
  const baselineRows =
    latestBaseline && Array.isArray(latestBaseline.properties.rows)
      ? (latestBaseline.properties.rows as Record<string, unknown>[])
      : undefined;
  const optionsById = new Map(items.map((i) => [i.id, i]));
  const missing = baselineRows
    ? baselineRows
        .filter(
          (row) =>
            optionsById.get(String(row.itemId))?.properties.required !== false,
        )
        .filter(
          (row) =>
            row.selectionStatus === "missing" ||
            (row.selectionStatus === "custom_required" &&
              /^(?:待定|未定|unknown|unspecified|missing|tbd)/i.test(
                String(row.partNumber),
              )),
        )
        .map((row) => String(row.name || row.itemId))
    : items
        .filter((i) => {
          if (i.kind !== "hardware-option" || i.properties.required === false)
            return false;
          if (i.properties.selectionStatus === "missing") return true;
          return (
            i.properties.selectionStatus === "custom_required" &&
            typeof i.properties.partNumber === "string" &&
            /^(?:待定|unknown|unspecified|missing|tbd)/i.test(
              i.properties.partNumber,
            )
          );
        })
        .map((i) => i.label);
  const currentOptions = baselineRows
    ? baselineRows
        .map((row) => optionsById.get(String(row.itemId)))
        .filter((i) => !!i)
    : items.filter(
        (i) =>
          i.kind === "hardware-option" &&
          i.properties.bomVersion === "dreamatic.bom/1",
      );
  const records = items.filter((i) => i.kind === "hardware-record");
  const unsupported = currentOptions
    .filter((i) => {
      const p = i.properties;
      if (
        p.required === false ||
        !["selected", "candidate"].includes(String(p.selectionStatus))
      )
        return false;
      const refs = Array.isArray(p.hardwareRefs) ? p.hardwareRefs : [];
      return !refs.some(
        (ref) =>
          ref &&
          records.some((record) => {
            const r = record.properties;
            return (
              r.source === ref.source &&
              r.recordId === ref.recordId &&
              r.revision === ref.revision &&
              r.evidence !== "requested_spec_not_supplier_fact"
            );
          }),
      );
    })
    .map((i) => `缺少硬件来源：${i.label}`);
  const requests = items.filter(
    (i) =>
      i.kind === "image-request" &&
      i.properties.imageSet === "appearance" &&
      i.properties.status === "pending",
  );
  const generated = new Set(
    [
      ...items,
      ...nodes.flatMap((n) =>
        (n.imageEvidence || []).flatMap((p) => p.data.structure),
      ),
    ]
      .filter(
        (i) =>
          i.kind === "generated-image" &&
          i.properties.imageSet === "appearance",
      )
      .flatMap((i) => i.references),
  );
  const pendingViews = [
    ...new Set(
      requests
        .filter((i) => !generated.has(i.id))
        .map((i) => String(i.properties.view)),
    ),
  ];
  const appearanceGaps: string[] = [];
  if (
    canonical &&
    (task.key !== "finish" ||
      [...ancestors.values()].some((n) => n.role === "designer"))
  ) {
    const model = items.filter((i) => i.kind === "appearance-model").at(-1);
    if (!model)
      appearanceGaps.push(
        "缺少真实统一外形CAD：请先构建appearance-design并执行build_appearance_geometry",
      );
    else {
      const ref = model.properties.appearanceRef;
      const images = items.filter(
        (i) =>
          i.kind === "generated-image" &&
          i.properties.generationMethod === "appearance_geometry" &&
          JSON.stringify(i.properties.appearanceRef) === JSON.stringify(ref) &&
          i.properties.geometryDigest === model.properties.geometryDigest,
      );
      if (
        !["front", "top", "side", "perspective"].every((v) =>
          images.some((i) => i.properties.view === v),
        )
      )
        appearanceGaps.push(
          "统一外形的几何一致四视图未完整生成，概念生图不能替代",
        );
    }
  }
  if (
    canonical &&
    task.key === "finish" &&
    [...ancestors.values()].some((n) => n.role === "mechanical")
  ) {
    const latestStructure = [...nodes]
      .reverse()
      .find(
        (n) =>
          ancestors.has(n.id) &&
          n.role === "mechanical" &&
          n.packet?.data.structure.some(
            (i) => i.properties.appearanceRef && i.kind !== "appearance-model",
          ),
      );
    if (!latestStructure)
      appearanceGaps.push(
        "缺少真实外形内的结构布置，旧box结果不满足当前几何要求",
      );
    else {
      appearanceGaps.push(
        ...layoutCoverageGaps(latestStructure.packet!, packets),
      );
      const body = latestStructure.packet!.data.structure.find(
        (i) => i.properties.appearanceRef && i.kind !== "appearance-model",
      )!;
      const latestModel = items
        .filter((i) => i.kind === "appearance-model")
        .at(-1);
      if (
        latestModel &&
        JSON.stringify(body.properties.appearanceRef) !==
          JSON.stringify(latestModel.properties.appearanceRef)
      )
        appearanceGaps.push("最新结构未使用当前外观CAD版本，需重新布置并投影");
      const projections = items.filter(
        (i) =>
          i.kind === "generated-image" &&
          i.properties.imageSet === "component_layout" &&
          i.properties.layoutSourceInvocationId === latestStructure.id &&
          JSON.stringify(i.properties.appearanceRef) ===
            JSON.stringify(body.properties.appearanceRef),
      );
      if (
        !["front", "top", "side"].every((v) =>
          projections.some((i) => i.properties.view === v),
        )
      )
        appearanceGaps.push("缺少同一真实外形内的最新零件轮廓三视图");
      else if (
        projections.some(
          (i) =>
            (i.properties.layoutFit as { passed?: boolean } | undefined)
              ?.passed !== true,
        )
      )
        appearanceGaps.push(
          "真实外形与零件的STEP干涉检查尚未通过，需调整布局或明确保留碰撞缺口",
        );
    }
  }
  return [
    ...new Set([
      ...appearanceGaps,
      ...assemblyGaps,
      ...prerequisites,
      ...missing.map((name) => `缺少硬件资料：${name}`),
      ...unsupported,
      ...(!canonical && pendingViews.length
        ? [`外观图片未实际生成：${pendingViews.join("、")}`]
        : []),
    ]),
  ];
}

export function failureCategory(error: string) {
  if (/上下文|输入\d+字符|长度限制/.test(error)) return "context";
  if (
    /JSON|BOM|hardware-option|unrecognized_keys|invalid_union|协议|引用|schema/i.test(
      error,
    )
  )
    return "protocol";
  if (/超时|timeout|429|rate.?limit/i.test(error)) return "transient";
  return error.slice(0, 160);
}
export function taskFingerprint(task: Task, error: string, requestId: string) {
  const category = failureCategory(error);
  const title = task.title
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/^(?:(?:重新|重试|修正|再次|继续|精简|输出)[：:\s]*)+/g, "")
    .trim();
  return JSON.stringify([
    task.role,
    category === "context" || /图片\/几何执行失败|外形特征/.test(error)
      ? ""
      : title,
    [...task.dependsOn].sort(),
    category,
    requestId,
  ]);
}
