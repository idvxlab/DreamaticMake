import { layoutCoverageGaps } from "./layout-coverage";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { channels, type Packet, type Invocation } from "./contracts";
import { appearanceStore, AppearanceStore } from "./appearance";
import { appearanceRefSchema } from "./appearance-contracts";
import { placementCenter } from "./placement";
import { hardwareLibrary, HardwareLibrary } from "./hardware";
import { hardwareGeometryRefSchema } from "./hardware-contracts";
import { imageStore, ImageStore, type ImageAsset } from "./images";

const vector = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => typeof n === "number" && Number.isFinite(n));
export async function renderLayoutViews(
  packets: Packet[],
  sourceInvocationId: string,
  observe: (asset: ImageAsset, sourceItemId: string) => Promise<void>,
  library: HardwareLibrary = hardwareLibrary,
  images: ImageStore = imageStore,
  appearances: AppearanceStore = appearanceStore,
) {
  const packet = packets.find((p) => p.invocationId === sourceInvocationId);
  if (!packet)
    throw new Error("必须依赖已完成的结构布置结果，不能猜测源调用ID");
  const coverageGaps = layoutCoverageGaps(packet, packets);
  if (coverageGaps.length)
    throw new Error(
      coverageGaps.join("；") +
        "。请结构工程师补齐完整布置后再投影，不能只画最后修改的单件。",
    );
  const parts: {
    id: string;
    file: string;
    stepFile?: string;
    bounds: { minMm: number[]; maxMm: number[] };
    positionMm: number[];
    rotationDeg: number[];
  }[] = [];
  const refs: unknown[] = [];
  const reservations: {
    id: string;
    dimensionsMm: number[];
    positionMm: number[];
    rotationDeg: number[];
  }[] = [];
  let exterior: { id: string; file: string } | undefined;
  let appearance: Awaited<ReturnType<AppearanceStore["read"]>> | undefined;
  let fit: { shell: string; outer: string } | undefined;
  const envelopes: {
    dimensionsMm: number[];
    positionMm: number[];
    rotationDeg: number[];
  }[] = [];
  for (const item of packet.data.structure) {
    const p = item.properties;
    if (p.appearanceRef) {
      const ref = appearanceRefSchema.parse(p.appearanceRef);
      const model = await appearances.read(ref.modelId);
      if (model.reference.revision !== ref.revision)
        throw new Error("布局外形版本与统一外观不符");
      if (
        appearance &&
        appearance.reference.modelId !== model.reference.modelId
      )
        throw new Error("一次布局只能使用一份外形源");
      appearance = model;
      exterior = {
        id: item.id,
        file: (
          await appearances.asset(ref.modelId, "appearance.stl", ref.revision)
        ).file,
      };
      fit = {
        shell: (
          await appearances.asset(ref.modelId, "shell.step", ref.revision)
        ).file,
        outer: (
          await appearances.asset(ref.modelId, "outer.step", ref.revision)
        ).file,
      };
    } else if (p.geometryRef) {
      const ref = hardwareGeometryRefSchema.parse(p.geometryRef);
      const geometry = await library.inspect(
        ref.source,
        ref.recordId,
        ref.assetId,
      );
      if (
        geometry.sha256 !== ref.sha256 ||
        geometry.reference.revision !== ref.revision
      )
        throw new Error("零件布局引用的CAD文件或版本已变化");
      const source = await library.mesh(ref.source, ref.recordId, ref.assetId);
      const bounds = { minMm: geometry.minMm, maxMm: geometry.maxMm };
      const position = placementCenter({ ...p, geometryBounds: bounds });
      const rotation = p.rotationDeg ?? [0, 0, 0];
      if (!position || !vector(rotation))
        throw new Error(
          "零件轮廓投影需要明确的三维位置和旋转，不能默认放在原点",
        );
      parts.push({
        id: item.id,
        file: source.file,
        stepFile:
          exterior ||
          packet.data.structure.some((i) => i.properties.appearanceRef)
            ? (await library.asset(ref.source, ref.recordId, ref.assetId)).file
            : undefined,
        bounds,
        positionMm: position,
        rotationDeg: rotation,
      });
      refs.push(ref);
    } else if (
      vector(p.dimensionsMm) &&
      p.dimensionsMm.every((n) => n > 0 && n < 10000) &&
      vector(p.positionMm)
    ) {
      const rotation = p.rotationDeg ?? [0, 0, 0];
      if (!vector(rotation)) throw new Error("壳体包络旋转无效");
      if (item.kind === "reserved-volume")
        reservations.push({
          id: item.id,
          dimensionsMm: p.dimensionsMm,
          positionMm: p.positionMm,
          rotationDeg: rotation,
        });
      envelopes.push({
        dimensionsMm: p.dimensionsMm,
        positionMm: p.positionMm,
        rotationDeg: rotation,
      });
    }
  }
  if (!parts.length || (!exterior && !envelopes.length))
    throw new Error(
      "零件轮廓组需要真实硬件几何及外壳提案包络，不能用生图模型补造",
    );
  const job = {
    parts,
    envelopes: exterior ? [] : envelopes,
    reservations: exterior ? reservations : [],
    exterior,
    fit,
    frameBounds: appearance
      ? [appearance.sceneBounds.minMm, appearance.sceneBounds.maxMm]
      : undefined,
  };
  const directory = resolve("workspace/workbench/layout-jobs", randomUUID());
  await mkdir(directory, { recursive: true });
  const input = resolve(directory, "input.json");
  await writeFile(input, JSON.stringify(job), { mode: 0o600 });
  const python =
    process.env.WORKBENCH_GEOMETRY_PYTHON ||
    resolve("../CAD生成相关/DreamaticMake/.venv/bin/python");
  const { stdout } = await promisify(execFile)(
    python,
    [resolve("workers/workbench/project_layout.py"), input, directory],
    {
      timeout: 180000,
      maxBuffer: 2000000,
      env: {
        ...process.env,
        MPLCONFIGDIR: resolve("workspace/workbench/.matplotlib"),
      },
    },
  );
  const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
  if (!result.sameScale || result.views?.length !== 3)
    throw new Error("三视图投影没有返回完整执行证据");
  const assets: ImageAsset[] = [];
  for (const view of ["front", "top", "side"] as const) {
    const bytes = await readFile(resolve(directory, view + ".png"));
    const asset = await images.saveProjection(
      {
        imageSet: "component_layout",
        projection: "orthographic",
        view,
        label: {
          front: "零件布置·正视轮廓",
          top: "零件布置·俯视轮廓",
          side: "零件布置·侧视轮廓",
        }[view],
        prompt: appearance
          ? "由同一外观CAD和真实零件网格作同尺度正交投影；绿色为真实外形轮廓，黑色为零件轮廓。没有box或凸包替代；无材质效果。"
          : "历史包络布置：真实硬件轮廓与旧外壳box提案；不能作为真实外形。",
      },
      bytes,
      sourceInvocationId,
      refs,
      createHash("sha256")
        .update(
          JSON.stringify({
            job,
            view,
            geometryDigest: appearance?.geometryDigest,
            generator: createHash("sha256")
              .update(
                await readFile(resolve("workers/workbench/project_layout.py")),
              )
              .digest("hex"),
            renderer: createHash("sha256")
              .update(
                await readFile(resolve("workers/workbench/geometry_views.py")),
              )
              .digest("hex"),
          }),
        )
        .digest("hex"),
      appearance
        ? {
            reference: appearance.reference,
            geometryDigest: appearance.geometryDigest,
            fit: result.fit,
          }
        : undefined,
    );
    assets.push(asset);
    await observe(asset, parts[0].id);
  }
  await writeFile(
    resolve(directory, "evidence.json"),
    JSON.stringify({ sourceInvocationId, result, assets }, null, 2),
    { mode: 0o600 },
  );
  return { assets, projection: result };
}

export function layoutTools(
  packets: Packet[],
  observe: (asset: ImageAsset, sourceItemId: string) => Promise<void>,
  audit: (
    activity: NonNullable<Invocation["toolActivity"]>[number],
  ) => Promise<void>,
) {
  let sourceId: string | undefined;
  let job: Promise<Awaited<ReturnType<typeof renderLayoutViews>>> | undefined;
  return [
    defineTool({
      name: "render_component_views",
      label: "投影零件布置轮廓三视图",
      description:
        "输入已经依赖的结构布置invocation ID，使用已检查的真实零件网格和明确变换生成三张同尺度正投影轮廓。外壳使用结构绑定的统一外观CAD真实轮廓，黑线为零件轮廓；真实STEP零件同时作布尔干涉检查，无材质、灯光或效果渲染，不调用图片模型。只报告该次实际检查范围，不等于整机装配或制造验证。",
      parameters: Type.Object({
        sourceInvocationId: Type.String({ minLength: 1, maxLength: 120 }),
      }),
      execute: async (_, args) => {
        try {
          if (sourceId && sourceId !== args.sourceInvocationId)
            throw new Error("一次轮廓任务只能使用同一份结构布置");
          sourceId = args.sourceInvocationId;
          job ||= renderLayoutViews(packets, args.sourceInvocationId, observe);
          const result = await job;
          await audit({
            tool: "render_component_views",
            success: true,
            source: args.sourceInvocationId,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  images: result.assets.map((a) => ({
                    itemId: `image:${a.id}`,
                    ...a,
                  })),
                  projection: result.projection,
                }),
              },
            ],
            details: {},
          };
        } catch (error) {
          await audit({
            tool: "render_component_views",
            success: false,
            error: (error as Error).message,
          });
          throw error;
        }
      },
    }),
  ];
}
