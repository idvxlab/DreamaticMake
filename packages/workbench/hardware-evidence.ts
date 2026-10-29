import { randomUUID } from "node:crypto";
import { VERSION, channels, type Packet } from "./contracts";
import { placementCenter } from "./placement";
import {
  hardwareRefSchema,
  hardwareGeometryRefSchema,
  bomLineSchema,
  bomBaselineSchema,
  type HardwareRecord,
  type HardwareGeometry,
} from "./hardware-contracts";

export function hardwarePacket(
  record: HardwareRecord,
  geometry?: HardwareGeometry,
): Packet {
  return {
    version: VERSION,
    id: randomUUID(),
    invocationId: "hardware-library",
    inputs: [],
    summary: `本地硬件证据：${record.title}`,
    evidence: geometry ? "executed" : "proposal",
    ...(geometry
      ? {
          execution: {
            tool: "OpenCascade STEP inspection",
            artifact: geometry.meshUrl,
            digest: geometry.sha256,
          },
        }
      : {}),
    data: {
      structure: [
        {
          id: record.itemId,
          kind: "hardware-record",
          label: record.title,
          properties: { ...record },
          references: [],
        },
        ...(geometry
          ? [
              {
                id: `hwgeom:${record.source}:${geometry.assetId}:${geometry.sha256.slice(0, 16)}`,
                kind: "hardware-geometry",
                label: `${record.title} · STEP实际包络`,
                properties: { ...geometry },
                references: [record.itemId],
              },
            ]
          : []),
      ],
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [],
    },
  };
}

export function validateHardwareReferences(packet: Packet, inputs: Packet[]) {
  const geometries = inputs
    .flatMap((p) => p.data.structure)
    .filter((i) => i.kind === "hardware-geometry");
  const records = new Map(
    inputs
      .flatMap((p) => channels.flatMap((c) => p.data[c]))
      .filter((i) => i.kind === "hardware-record")
      .map((i) => [i.id, i.properties]),
  );
  for (const channel of channels)
    for (const item of packet.data[channel]) {
      if (item.kind === "bom-baseline") {
        const baseline = bomBaselineSchema.parse(item.properties);
        for (const key of ["excluded", "procedures", "openChecks"] as const)
          item.properties[key] = baseline[key];
        const options = new Map(
          [...inputs, packet]
            .flatMap((p) => channels.flatMap((c) => p.data[c]))
            .map((i) => [i.id, i]),
        );
        for (const row of baseline.rows) {
          const option = options.get(row.itemId);
          if (option?.kind !== "hardware-option")
            throw new Error(
              `BOM行 ${row.itemId} 没有实际硬件选型条目，不能在汇总时创造物料`,
            );
          const line = bomLineSchema.parse(option.properties);
          for (const key of [
            "partNumber",
            "quantity",
            "unit",
            "selectionStatus",
          ] as const)
            if (row[key] !== line[key])
              throw new Error(
                `BOM行 ${row.itemId} 的 ${key} 与专家物料不一致；先纠正物料再汇总，不能默默换型号或改数量`,
              );
          if (!item.references.includes(row.itemId))
            item.references.push(row.itemId);
        }
      }
      if (item.properties.bomVersion !== undefined) {
        if (item.kind !== "hardware-option")
          throw new Error(
            "BOM物料须使用hardware-option；说明与固件移到logic，不能作为物料计数",
          );
        const line = bomLineSchema.parse(item.properties);
        if (
          line.selectionStatus === "selected" &&
          line.hardwareRefs.some((ref) => {
            const record = [...records.values()].find(
              (r) =>
                r.source === ref.source &&
                r.recordId === ref.recordId &&
                r.revision === ref.revision,
            );
            return record?.evidence === "requested_spec_not_supplier_fact";
          })
        )
          throw new Error("采购需求不是已选定的供应商型号，不能标selected");
      }
      if (item.kind === "hardware-record" || item.kind === "hardware-geometry")
        throw new Error(
          "硬件证据条目只能由本地库生成，模型只能引用，不能自行创建",
        );
      if (item.properties.geometryRef !== undefined) {
        const ref = hardwareGeometryRefSchema.parse(
          item.properties.geometryRef,
        );
        const evidence = geometries.find((i) => {
          const g = i.properties as unknown as HardwareGeometry;
          return (
            g.reference.source === ref.source &&
            g.reference.recordId === ref.recordId &&
            g.reference.revision === ref.revision &&
            g.assetId === ref.assetId &&
            g.sha256 === ref.sha256
          );
        });
        if (!evidence)
          throw new Error("几何引用未经实际STEP检查，或型号/文件/版本不符");
        const g = evidence.properties as unknown as HardwareGeometry;
        const declared = item.properties.dimensionsMm;
        if (
          declared !== undefined &&
          (!Array.isArray(declared) ||
            declared.length !== 3 ||
            declared.some(
              (v, i) =>
                typeof v !== "number" ||
                (Math.abs(v - g.dimensionsMm[i]) > 0.001 &&
                  v !== Number(g.dimensionsMm[i].toFixed(2))),
            ))
        )
          throw new Error(
            `条目 ${item.id} 的元件尺寸与实际STEP原始XYZ包络不符：声明 ${JSON.stringify(declared)}，原始 ${JSON.stringify(g.dimensionsMm)}。可以省略dimensionsMm由后端回填；用rotationDeg安排方向，外壳另建不带geometryRef的提案条目，不能改写元件几何`,
          );
        item.properties.dimensionsMm = g.dimensionsMm;
        item.properties.meshUrl = g.meshUrl;
        item.properties.geometryBounds = { minMm: g.minMm, maxMm: g.maxMm };
        if (
          item.properties.positionMm === undefined &&
          item.properties.translationMm !== undefined
        ) {
          const center = placementCenter(item.properties);
          if (!center)
            throw new Error(
              "原生CAD平移需要sourceFrame:source-cad-native/1、有效translationMm与rotationDeg，或提供明确的包络中心positionMm",
            );
          item.properties.positionMm = center;
          item.properties.placementEvidence = "model_proposed_native_transform";
        }
        item.properties.geometryCoverage = g.coverage;
        item.properties.dimensionsEvidence = "step_file_bounds";
        item.properties.hardwareRefs ||= [g.reference];
        if (!item.references.includes(evidence.id))
          item.references.push(evidence.id);
      } else if (item.properties.meshUrl !== undefined) {
        throw new Error(
          "模型网格必须通过geometryRef绑定已检查的库资产，不能自行填写meshUrl",
        );
      }
      const refs = item.properties.hardwareRefs;
      if (refs !== undefined) {
        if (!Array.isArray(refs) || refs.length > 30)
          throw new Error("hardwareRefs必须是最多30项的数组");
        for (const value of refs) {
          const ref = hardwareRefSchema.parse(value);
          const record = [...records.values()].find(
            (r) =>
              r.source === ref.source &&
              r.recordId === ref.recordId &&
              r.revision === ref.revision,
          );
          if (!record)
            throw new Error(
              "硬件引用不存在或版本不符，请先使用hardware_get读取真实记录",
            );
          const id = String(record.itemId);
          if (!item.references.includes(id)) item.references.push(id);
        }
      }
      if (item.kind === "hardware-option" || refs !== undefined) {
        item.properties.libraryBinding =
          Array.isArray(refs) && refs.length
            ? "source_referenced_proposal"
            : "unbound_model_proposal";
        item.properties.physicalVerified = false;
        item.properties.assemblyVerified = false;
      }
    }
}
