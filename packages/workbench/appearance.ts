import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { VERSION, type Packet } from "./contracts";
import { ImageStore, imageStore, type ImageAsset } from "./images";
import {
  APPEARANCE_VERSION,
  appearanceDesignSchema,
  appearanceRefSchema,
  type AppearanceModel,
} from "./appearance-contracts";

const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export class AppearanceStore {
  constructor(
    readonly directory = resolve("workspace/workbench/appearance"),
    readonly images: ImageStore = imageStore,
    readonly python = process.env.WORKBENCH_GEOMETRY_PYTHON ||
      resolve("../CAD生成相关/DreamaticMake/.venv/bin/python"),
  ) {}
  private folder(id: string) {
    return resolve(this.directory, appearanceRefSchema.shape.modelId.parse(id));
  }
  async read(id: string) {
    const model = JSON.parse(
      await readFile(resolve(this.folder(id), "model.json"), "utf8"),
    ) as AppearanceModel;
    appearanceRefSchema.parse(model.reference);
    if (model.reference.modelId !== id || model.version !== APPEARANCE_VERSION)
      throw new Error("外形模型版本无效");
    return model;
  }
  async asset(id: string, assetId: string, revision?: string, sha256?: string) {
    if (
      !/^(?:(?:appearance|shell|outer|interior)\.(?:step|stl)|feature-[a-zA-Z0-9_-]+\.stl|report\.json)$/.test(
        assetId,
      )
    )
      throw new Error("外形资产名称无效");
    const model = await this.read(id);
    const asset = model.assets.find((a) => a.id === assetId);
    if (
      !asset ||
      (revision && revision !== model.reference.revision) ||
      (sha256 && sha256 !== asset.sha256)
    )
      throw new Error("外形资产版本不符");
    const file = resolve(this.folder(id), assetId);
    const bytes = await readFile(file);
    if (hash(bytes) !== asset.sha256) throw new Error("外形资产SHA-256不符");
    return { model, asset, file, bytes };
  }
  async build(raw: unknown, sourceItemId: string) {
    const design = appearanceDesignSchema.parse(raw);
    const generator = await readFile(
      resolve("workers/workbench/build_appearance.py"),
    );
    const renderer = await readFile(
      resolve("workers/workbench/geometry_views.py"),
    );
    const inputDigest = hash(
      JSON.stringify({ design, sourceItemId }) +
        hash(generator) +
        hash(renderer),
    );
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const cache = resolve(this.directory, inputDigest + ".cache");
    try {
      const cached = JSON.parse(await readFile(cache, "utf8"));
      const model = await this.read(cached.id);
      await this.asset(
        model.reference.modelId,
        "appearance.step",
        model.reference.revision,
      );
      await this.asset(
        model.reference.modelId,
        "shell.stl",
        model.reference.revision,
      );
      const images = await Promise.all(
        (cached.images as string[]).map(
          async (id) => (await this.images.read(id)).asset,
        ),
      );
      return { model, images, cached: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const id = randomUUID();
    const folder = this.folder(id);
    await mkdir(folder, { mode: 0o700 });
    const input = resolve(folder, "design.json");
    await writeFile(input, JSON.stringify(design), { mode: 0o600 });
    try {
      await promisify(execFile)(
        this.python,
        [resolve("workers/workbench/build_appearance.py"), input, folder],
        {
          timeout: 180000,
          maxBuffer: 3_000_000,
          env: {
            ...process.env,
            MPLCONFIGDIR: resolve("workspace/workbench/.matplotlib"),
          },
        },
      );
    } catch (error) {
      const e = error as Error & { stderr?: string };
      const cause =
        (e.stderr || e.message).trim().split("\n").at(-1) || "外形CAD执行失败";
      const missed = design.features.find((f) =>
        cause.includes("Feature misses exterior: " + f.id),
      );
      if (missed)
        throw new Error(
          `外形特征${missed.id}未命中外壳：face=${missed.face}，centerMm=${JSON.stringify(missed.centerMm)}。front/back的centerMm必须是[X,Z]（Y由face决定），left/right是[Y,Z]，top/bottom是[X,Y]。请先修正appearance-design再构建，不能原参数重试。`,
        );
      throw new Error("外形CAD执行失败：" + cause.slice(-1200));
    }
    const report = JSON.parse(
      await readFile(resolve(folder, "report.json"), "utf8"),
    );
    if (
      report.version !== APPEARANCE_VERSION ||
      !Object.values(report.checks).every(Boolean) ||
      !report.viewEvidence.sameScale
    )
      throw new Error("外形CAD执行证据无效");
    const assets = (report.assets as AppearanceModel["assets"]).filter(
      (a) => !a.id.endsWith(".png"),
    );
    assets.push({
      id: "report.json",
      sha256: hash(await readFile(resolve(folder, "report.json"))),
      bytes: (await readFile(resolve(folder, "report.json"))).length,
      url: "",
    });
    const step = assets.find((a) => a.id === "appearance.step")!;
    if (!step) throw new Error("外形没有STEP产物");
    const revision = hash(
      JSON.stringify({
        inputDigest,
        assets: assets.map((a) => ({ id: a.id, sha256: a.sha256 })),
      }),
    );
    const reference = { modelId: id, revision };
    for (const asset of assets) {
      if (hash(await readFile(resolve(folder, asset.id))) !== asset.sha256)
        throw new Error("生成的外形文件哈希不符");
      await chmod(resolve(folder, asset.id), 0o600);
      asset.url = `/workbench-api/appearance/${id}/${asset.id}?revision=${revision}&sha256=${asset.sha256}`;
    }
    const bounds = report.bodyBounds;
    const model: AppearanceModel = {
      version: APPEARANCE_VERSION,
      reference,
      itemId: `appearance:${id}:${revision.slice(0, 16)}`,
      label: design.label,
      design,
      sourceItemId,
      bodyBounds: bounds,
      dimensionsMm: bounds.maxMm.map(
        (v: number, i: number) => v - bounds.minMm[i],
      ),
      positionMm: bounds.maxMm.map(
        (v: number, i: number) => (v + bounds.minMm[i]) / 2,
      ),
      sceneBounds: report.sceneBounds,
      assets,
      meshUrl: assets.find((a) => a.id === "shell.stl")!.url,
      stepUrl: step.url,
      interiorStepUrl: assets.find((a) => a.id === "interior.step")!.url,
      geometryDigest: step.sha256,
      checks: report.checks,
      physicalVerified: false,
      assemblyVerified: false,
    };
    const images: ImageAsset[] = [];
    for (const view of ["front", "top", "side", "perspective"] as const) {
      images.push(
        await this.images.saveAppearanceView(
          {
            imageSet: "appearance",
            projection: view === "perspective" ? "axonometric" : "orthographic",
            view,
            label: `外形几何·${{ front: "正视", top: "俯视", side: "侧视", perspective: "轴测" }[view]}`,
            prompt:
              "从同一外形CAD模型作固定正交相机渲染；真实圆角、收分与接口几何，无内部主板。",
          },
          await readFile(resolve(folder, view + ".png")),
          reference,
          step.sha256,
          inputDigest,
        ),
      );
    }
    await writeFile(
      resolve(folder, "model.json"),
      JSON.stringify(model, null, 2),
      { mode: 0o600 },
    );
    const temp = cache + ".tmp-" + randomUUID();
    await writeFile(
      temp,
      JSON.stringify({ id, images: images.map((a) => a.id) }),
      { mode: 0o600 },
    );
    await rename(temp, cache);
    return { model, images, cached: false };
  }
}
export const appearanceStore = new AppearanceStore();
export function appearancePacket(model: AppearanceModel): Packet {
  return {
    version: VERSION,
    id: randomUUID(),
    invocationId: "appearance-geometry",
    inputs: [],
    summary: `已构建统一外形：${model.label}`,
    evidence: "executed",
    execution: {
      tool: "build_appearance_geometry",
      artifact: model.stepUrl,
      digest: model.geometryDigest,
    },
    data: {
      structure: [
        {
          id: model.itemId,
          kind: "appearance-model",
          label: model.label,
          properties: { ...model, appearanceRef: model.reference },
          references: [model.sourceItemId],
        },
      ],
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [],
    },
  };
}
