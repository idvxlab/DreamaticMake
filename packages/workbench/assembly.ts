import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { Euler, MathUtils, Vector3 } from "three";
import { VERSION, type Packet } from "./contracts";
import {
  assemblyDesignSchema,
  type AssemblyDesign,
} from "./assembly-contracts";
import { executeAssemblyDesign } from "./assembly-tools";
import { appearanceStore, type AppearanceStore } from "./appearance";
import { hardwareLibrary, type HardwareLibrary } from "./hardware";
import { layoutCoverageGaps } from "./layout-coverage";
import { placementCenter } from "./placement";
import { hardwareGeometryRefSchema } from "./hardware-contracts";

const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const assetName =
  /^(?:(?:base|lid)(?:-assembly\.step|\.(?:step|stl))|report\.json)$/;
export type AssemblyResult = {
  version: "dreamatic.assembly-result/1";
  id: string;
  revision: string;
  itemId: string;
  sourceItemId: string;
  sourceLayoutInvocationId: string;
  design: AssemblyDesign;
  report: Record<string, any>;
  assets: { id: string; sha256: string; bytes: number; url: string }[];
  gaps: string[];
  geometryChecksPassed: boolean;
  physicalVerified: false;
  printed: false;
  assemblyVerified: false;
};
export class AssemblyStore {
  constructor(
    readonly directory = resolve("workspace/workbench/assemblies"),
    readonly appearances: Pick<
      AppearanceStore,
      "read" | "asset"
    > = appearanceStore,
    readonly library: Pick<
      HardwareLibrary,
      "inspect" | "asset"
    > = hardwareLibrary,
    readonly execute: typeof executeAssemblyDesign = executeAssemblyDesign,
  ) {}
  private folder(id: string) {
    return resolve(this.directory, z.string().uuid().parse(id));
  }
  async read(id: string): Promise<AssemblyResult> {
    const result = JSON.parse(
      await readFile(resolve(this.folder(id), "model.json"), "utf8"),
    ) as AssemblyResult;
    if (result.id !== id || result.version !== "dreamatic.assembly-result/1")
      throw new Error("装配产物记录无效");
    digest.parse(result.revision);
    return result;
  }
  async asset(id: string, name: string, revision: string, sha: string) {
    if (!assetName.test(name)) throw new Error("装配资产路径无效");
    digest.parse(revision);
    digest.parse(sha);
    const model = await this.read(id);
    const asset = model.assets.find((a) => a.id === name);
    if (model.revision !== revision || !asset || asset.sha256 !== sha)
      throw new Error("装配资产版本或摘要不符");
    const bytes = await readFile(resolve(this.folder(id), name));
    if (hash(bytes) !== sha) throw new Error("装配文件摘要已变化");
    return { model, asset, bytes };
  }
  async build(
    packets: Packet[],
    designItemId: string,
  ): Promise<AssemblyResult> {
    const item = packets
      .flatMap((p) => p.data.structure)
      .find((i) => i.id === designItemId && i.kind === "assembly-design");
    if (!item)
      throw new Error("需要依赖已有assembly-design，不能自行提交文件路径");
    const design = assemblyDesignSchema.parse(item.properties);
    const ref = design.appearanceRef;
    const candidates = packets.filter(
      (p) =>
        p.data.structure.some((i) => i.kind === "component-instance") &&
        p.data.structure.some(
          (i) =>
            i.kind !== "appearance-model" &&
            i.kind !== "assembly-design" &&
            JSON.stringify(i.properties.appearanceRef) === JSON.stringify(ref),
        ),
    );
    // Explicit layout references prevent silently selecting an unrelated or older snapshot.
    const layout = candidates.at(-1);
    if (
      !layout ||
      !layout.data.structure
        .filter((i) => i.kind === "component-instance")
        .every((i) => item.references.includes(i.id))
    )
      throw new Error("装配设计必须引用最新完整结构快照中的每一个零件实例");
    const gaps = layoutCoverageGaps(layout, packets);
    if (gaps.length) throw new Error(gaps.join("；"));
    if (layout.data.structure.some((i) => i.kind === "reserved-volume"))
      throw new Error(
        "结构仍含估计预留体积；可保留概念方案，但不能宣称完整真实零件装配检查",
      );
    const components = layout.data.structure.filter(
      (i) => i.kind === "component-instance",
    );
    if (
      components.length !== design.instances.length ||
      components.some((i) => !design.instances.some((d) => d.id === i.id))
    )
      throw new Error("装配设计必须保留完整实例基线");
    const model = await this.appearances.read(ref.modelId);
    if (model.reference.revision !== ref.revision)
      throw new Error("装配外形版本已变化");
    if (
      !packets.some((p) =>
        p.data.structure.some(
          (i) => i.kind === "appearance-model" && i.id === model.itemId,
        ),
      )
    )
      throw new Error("缺少实际外形执行证据");
    const shell = await this.appearances.asset(
      ref.modelId,
      "shell.step",
      ref.revision,
      design.shellSha256,
    );
    const outer = await this.appearances.asset(
      ref.modelId,
      "outer.step",
      ref.revision,
      design.outerSha256,
    );
    const instances: Record<string, string> = {};
    for (const component of components) {
      const original = hardwareGeometryRefSchema.parse(
        component.properties.geometryRef,
      );
      const selected = design.instances.find((i) => i.id === component.id)!;
      if (
        JSON.stringify(
          hardwareGeometryRefSchema.parse(selected.geometryRef),
        ) !== JSON.stringify(original)
      )
        throw new Error("装配不能改写结构快照的零件来源或版本");
      const geometry = await this.library.inspect(
        original.source,
        original.recordId,
        original.assetId,
      );
      if (
        geometry.sha256 !== original.sha256 ||
        geometry.reference.revision !== original.revision
      )
        throw new Error("真实零件CAD版本或摘要已变化");
      const position = placementCenter({
        ...component.properties,
        geometryBounds: geometry,
      });
      const rotation = z
        .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
        .parse(component.properties.rotationDeg ?? [0, 0, 0]);
      if (!position) throw new Error("零件布置缺少明确坐标");
      const center = new Vector3(...geometry.minMm)
        .add(new Vector3(...geometry.maxMm))
        .multiplyScalar(0.5);
      center.applyEuler(
        new Euler(
          ...(rotation.map(MathUtils.degToRad) as [number, number, number]),
          "XYZ",
        ),
      );
      const translation = position.map((n, j) => n - center.toArray()[j]);
      if (
        rotation.some((n, j) => Math.abs(n - selected.rotationDeg[j]) > 1e-8) ||
        translation.some(
          (n, j) => Math.abs(n - selected.translationMm[j]) > 1e-6,
        )
      )
        throw new Error("装配实例姿态与结构快照不符；调整布局后再提交新设计");
      const asset = await this.library.asset(
        original.source,
        original.recordId,
        original.assetId,
      );
      if (asset.sha256 !== original.sha256) throw new Error("零件文件摘要不符");
      instances[component.id] = asset.file;
    }
    const id = randomUUID(),
      directory = this.folder(id);
    await mkdir(directory, { recursive: true });
    const report = await this.execute(
      design,
      { shellFile: shell.file, outerFile: outer.file, instances },
      components.map((i) => i.id),
      directory,
    );
    if (
      typeof report.geometryChecksPassed !== "boolean" ||
      !Array.isArray(report.assets)
    )
      throw new Error("执行器没有返回有效检查报告");
    // Never publish executable/path entries supplied by a model or worker.
    const names = [
      ...new Set<string>([
        ...report.assets.map((a: any) => (typeof a === "string" ? a : a.id)),
        "report.json",
      ]),
    ];
    if (names.length !== 7 || names.some((n) => !assetName.test(n)))
      throw new Error("执行器返回非登记资产");
    const files = await Promise.all(
      names.map(async (name) => {
        const bytes = await readFile(resolve(directory, name));
        return { id: name, sha256: hash(bytes), bytes: bytes.length };
      }),
    );
    const revision = hash(
      JSON.stringify({
        design,
        sourceItemId: item.id,
        sourceLayoutInvocationId: layout.invocationId,
        files,
      }),
    );
    const result: AssemblyResult = {
      version: "dreamatic.assembly-result/1",
      id,
      revision,
      itemId: `assembly:${id}`,
      sourceItemId: item.id,
      sourceLayoutInvocationId: layout.invocationId,
      design,
      report,
      gaps: Array.isArray(report.gaps) ? report.gaps : [],
      geometryChecksPassed: report.geometryChecksPassed,
      assets: files.map((a) => ({
        ...a,
        url: `/workbench-api/assembly/${id}/${a.id}?revision=${revision}&sha256=${a.sha256}`,
      })),
      physicalVerified: false,
      printed: false,
      assemblyVerified: false,
    };
    await writeFile(
      resolve(directory, "model.json"),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    return result;
  }
}
export const assemblyStore = new AssemblyStore();
export function assemblyPacket(result: AssemblyResult): Packet {
  return {
    version: VERSION,
    id: randomUUID(),
    invocationId: "assembly",
    inputs: [],
    summary: result.geometryChecksPassed
      ? "分件几何检查通过；实物打印与装配未验证"
      : "已生成分件，几何检查存在缺口",
    evidence: "executed",
    execution: {
      tool: "build_printable_assembly",
      artifact: result.itemId,
      digest: result.revision,
    },
    data: {
      structure: [
        {
          id: result.itemId,
          kind: "assembly-model",
          label: "可拆装结构与打印分件",
          properties: result,
          references: [result.sourceItemId],
        },
      ],
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [],
    },
  };
}
export function validateAssemblyOutput(packet: Packet) {
  for (const item of Object.values(packet.data).flat()) {
    if (item.kind === "assembly-model")
      throw new Error("assembly-model只能由实际装配执行器创建");
    if (item.kind === "assembly-design")
      item.properties = assemblyDesignSchema.parse(item.properties);
  }
}
