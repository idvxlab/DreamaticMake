import { layoutCoverageGaps } from "./layout-coverage";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { channels, type Packet, type Invocation } from "./contracts";
import { appearanceStore, type AppearanceStore } from "./appearance";
import {
  appearanceDesignSchema,
  appearanceRefSchema,
  type AppearanceModel,
} from "./appearance-contracts";
import type { ImageAsset } from "./images";

export function appearanceTools(
  packets: Packet[],
  observe: (model: AppearanceModel) => Promise<void>,
  image: (asset: ImageAsset, sourceId: string) => Promise<void>,
  audit: (
    activity: NonNullable<Invocation["toolActivity"]>[number],
  ) => Promise<void>,
  store: AppearanceStore = appearanceStore,
) {
  const designs = new Map(
    packets
      .flatMap((p) => p.data.structure)
      .filter((i) => i.kind === "appearance-design")
      .map((i) => [i.id, i]),
  );
  let job: Promise<Awaited<ReturnType<AppearanceStore["build"]>>> | undefined;
  let selected: string | undefined;
  return [
    defineTool({
      name: "build_appearance_geometry",
      label: "构建统一外形并渲染几何一致四视图",
      description:
        "执行输入中已有的appearance-design条目：从圆角/椭圆截面放样真实外形、挖出内腔并切接口；保存STEP/STL，从同一个CAD生成正视/俯视/侧视/轴测四图。外观不显示内部主板。后续结构必须以返回的appearance-model为唯一外形源；不是照片精确重建或制造验证。先让设计师输出设计条目，再委派下一调用执行。",
      parameters: Type.Object({
        designItemId: Type.String({ minLength: 1, maxLength: 240 }),
      }),
      execute: async (_, args) => {
        try {
          const item = designs.get(args.designItemId);
          if (!item)
            throw new Error(
              "需要依赖已有appearance-design，不能猜测设计条目ID",
            );
          if (selected && selected !== item.id)
            throw new Error("一次调用只能构建一个统一外形版本");
          selected = item.id;
          job ||= store.build(item.properties, item.id);
          const result = await job;
          await observe(result.model);
          for (const asset of result.images) await image(asset, item.id);
          await audit({
            tool: "build_appearance_geometry",
            success: true,
            source: result.model.itemId,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  modelItemId: result.model.itemId,
                  appearanceRef: result.model.reference,
                  dimensionsMm: result.model.dimensionsMm,
                  positionMm: result.model.positionMm,
                  geometryDigest: result.model.geometryDigest,
                  stepUrl: result.model.stepUrl,
                  checks: result.model.checks,
                  images: result.images.map((a) => ({
                    itemId: `image:${a.id}`,
                    view: a.view,
                    sha256: a.sha256,
                  })),
                  physicalVerified: false,
                  assemblyVerified: false,
                  cached: result.cached,
                }),
              },
            ],
            details: {},
          };
        } catch (e) {
          await audit({
            tool: "build_appearance_geometry",
            success: false,
            error: (e as Error).message,
          });
          throw e;
        }
      },
    }),
  ];
}

/** Only backend execution evidence can supply an exterior, its dimensions and URLs. */
export function validateAppearanceOutput(
  packet: Packet,
  inputs: Packet[],
  strict = false,
) {
  const sources = inputs
    .flatMap((p) => p.data.structure)
    .filter((i) => i.kind === "appearance-model");
  const models = new Map(sources.map((i) => [i.id, i]));
  for (const channel of channels)
    for (const item of packet.data[channel]) {
      const p = item.properties;
      if (item.kind === "appearance-model")
        throw new Error(
          "appearance-model只能由build_appearance_geometry执行器创建",
        );
      if (item.kind === "appearance-design")
        item.properties = appearanceDesignSchema.parse(p);
      if (p.appearanceItemId !== undefined || p.appearanceRef !== undefined) {
        const source = p.appearanceItemId
          ? models.get(String(p.appearanceItemId))
          : sources.find(
              (i) =>
                JSON.stringify(
                  appearanceRefSchema.parse(i.properties.appearanceRef),
                ) ===
                JSON.stringify(appearanceRefSchema.parse(p.appearanceRef)),
            );
        if (!source) throw new Error("外形引用没有对应的真实CAD执行证据");
        const m = source.properties as unknown as AppearanceModel & {
          appearanceRef: AppearanceModel["reference"];
        };
        if (
          p.appearanceRef &&
          JSON.stringify(appearanceRefSchema.parse(p.appearanceRef)) !==
            JSON.stringify(m.reference)
        )
          throw new Error("统一外形版本不符");
        for (const key of ["dimensionsMm", "positionMm"] as const)
          if (
            p[key] !== undefined &&
            JSON.stringify(p[key]) !== JSON.stringify(m[key])
          )
            throw new Error(
              "结构不可改写统一外形的尺寸或坐标，请先修改外形设计并重新构建",
            );
        if (
          p.rotationDeg !== undefined &&
          JSON.stringify(p.rotationDeg) !== "[0,0,0]"
        )
          throw new Error("统一外形必须保持共享世界坐标");
        if (item.kind !== "assembly-design")
          Object.assign(p, {
            appearanceRef: m.reference,
            appearanceItemId: source.id,
            dimensionsMm: m.dimensionsMm,
            positionMm: m.positionMm,
            rotationDeg: [0, 0, 0],
            geometryFrame: "xyz-mm-center-z-up/1",
            geometryBounds: m.bodyBounds,
            dimensionsEvidence: "appearance_file_bounds",
            meshUrl: m.meshUrl,
            stepUrl: m.stepUrl,
            geometryDigest: m.geometryDigest,
            physicalVerified: false,
            assemblyVerified: false,
          });
        if (!item.references.includes(source.id))
          item.references.push(source.id);
      } else if (
        typeof p.meshUrl === "string" &&
        p.meshUrl.startsWith("/workbench-api/appearance/")
      )
        throw new Error(
          "外形网格必须绑定真实appearanceItemId，不能自行填写链接",
        );
    }
  const items = packet.data.structure;
  if (
    strict &&
    items.some(
      (i) => i.kind === "component-instance" && i.properties.geometryRef,
    )
  ) {
    const gaps = layoutCoverageGaps(packet, inputs);
    if (gaps.length)
      throw new Error(
        gaps.join("；") +
          "。每次结构输出必须包含完整保留实例与明确预留体积，不能只返回修改项；可省略由geometryItemId回填的尺寸与网格元数据。",
      );
  }
  if (
    strict &&
    items.some((i) => i.properties.geometryRef) &&
    !items.some((i) => i.properties.appearanceRef)
  )
    throw new Error(
      "结构布置必须绑定同一外形CAD的appearanceItemId，不能使用box替代轮廓",
    );
  if (
    strict &&
    items.some(
      (i) =>
        /^(enclosure-instance|enclosure-proposal|product-envelope|enclosure-envelope)$/.test(
          i.kind,
        ) && !i.properties.appearanceRef,
    )
  )
    throw new Error("结构外壳缺少统一外形CAD绑定，不能新造长方体外壳");
}
