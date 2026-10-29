import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { channels, type Packet, type Invocation } from "./contracts";
import {
  imageViews,
  imageRequestSchema,
  ImageStore,
  type ImageAsset,
} from "./images";

export function imageTools(
  store: ImageStore,
  packets: Packet[],
  observe: (asset: ImageAsset, requestId: string) => Promise<void>,
  audit: (
    activity: NonNullable<Invocation["toolActivity"]>[number],
  ) => Promise<void>,
) {
  const requests = new Map(
    packets
      .flatMap((p) => channels.flatMap((c) => p.data[c]))
      .filter(
        (i) =>
          i.kind === "image-request" && typeof i.properties.prompt === "string",
      )
      .map((i) => [i.id, i]),
  );
  const results = new Map<string, ImageAsset>();
  const inheritedPerspective = packets
    .flatMap((p) => p.data.structure)
    .filter(
      (i) =>
        i.kind === "generated-image" &&
        i.properties.imageSet === "appearance" &&
        i.properties.view === "perspective" &&
        i.references.some((id) => requests.has(id)),
    )
    .at(-1);
  const failures = new Map<string, string>();
  const envelope = packets
    .flatMap((p) => p.data.structure)
    .filter(
      (i) =>
        /^(enclosure-proposal|product-envelope|enclosure-envelope)$/.test(
          i.kind,
        ) &&
        Array.isArray(i.properties.dimensionsMm) &&
        i.properties.dimensionsMm.length === 3 &&
        i.properties.dimensionsMm.every((v) => typeof v === "number" && v > 0),
    )
    .at(-1);
  return [
    defineTool({
      name: "generate_product_images",
      label: "生成真实产品外观图",
      description:
        "只执行imageSet=appearance的纯外观image-request，不显示主板或内部零件。零件轮廓组使用render_component_views。执行输入数据包中已存在的image-request。传入1–4个条目ID，按透视、正视、俯视、侧视顺序。图片实际由已配置的专用生图模型生成并保存到本机，后续视图以前一组透视图作为视觉参考。输出是概念效果图，不证明工程尺寸、CAD或可制造性。不得传入编造的请求ID。",
      parameters: Type.Object({
        requestIds: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), {
          minItems: 1,
          maxItems: 4,
        }),
      }),
      execute: async (_, args) => {
        if (new Set(args.requestIds).size !== args.requestIds.length)
          throw new Error("图像请求ID不能重复");
        const selected = args.requestIds.map((id) => {
          const item = requests.get(id);
          if (!item)
            throw new Error(
              "需要先由外观设计师输出image-request，再依赖该结果调用生图工具",
            );
          return item;
        });
        if (
          new Set([...results.keys(), ...failures.keys(), ...args.requestIds])
            .size > 4
        )
          throw new Error("每次外观调用最多生成四个视图");
        selected.sort(
          (a, b) =>
            imageViews.indexOf(a.properties.view as any) -
            imageViews.indexOf(b.properties.view as any),
        );
        for (const item of selected) {
          if (results.has(item.id)) continue;
          if (failures.has(item.id)) throw new Error(failures.get(item.id));
          try {
            const request = imageRequestSchema.parse({
              imageSet: item.properties.imageSet,
              view: item.properties.view,
              prompt: item.properties.prompt,
              label: item.label,
            });
            if (request.imageSet !== "appearance")
              throw new Error(
                "必须先生成imageSet=appearance的纯外观请求；旧混合提示词不能执行，零件布置组改用render_component_views",
              );
            let first = [...results.values()].find(
              (a) => a.view === "perspective",
            );
            if (
              !first &&
              request.view !== "perspective" &&
              inheritedPerspective
            ) {
              const saved = await store.read(
                String(inheritedPerspective.properties.id),
              );
              if (saved.asset.sha256 !== inheritedPerspective.properties.sha256)
                throw new Error("引用的轴测图与保存的图片证据不符");
              first = saved.asset;
            }
            const cameras = {
              perspective:
                "轴测图：采用正交轴测相机，三分之四视角，平行投影，无消失点，展示正常完整成品外壳。",
              front:
                "FRONT ORTHOGRAPHIC ELEVATION ONLY. 摄像机沿-Y方向看向+Y，只显示正面外立面，X向右Z向上，绝不能看见顶面或侧面。不要三分之四视角，不要透视。",
              top: "TOP ORTHOGRAPHIC PLAN ONLY. 摄像机在+Z正上方垂直向下，顶面平行于画面，只看见外壳顶面，不能看见前壁、侧壁或厚度。X水平Y竖直。No perspective, no isometric view, no oblique angle.",
              side: "RIGHT ORTHOGRAPHIC ELEVATION ONLY. 摄像机从+X沿-X观察，只显示右侧外立面，Y水平Z向上，不能看见顶面或前后端面。No perspective or isometric angle.",
            };
            const ratio = envelope
              ? `\n外壳比例必须使用同一三维布局的提案包络，XYZ依次为宽、长、高：${JSON.stringify(envelope.properties.dimensionsMm)} mm。顶视图宽:长、正视图宽:高、侧视图长:高必须对应这一比例，轴测图也须保持相同长宽高比例。数字只用于约束造型，不在图上画任何数值或尺寸线。`
              : "";
            const prompt =
              request.prompt +
              (first
                ? "\n所附图片只用于保持同一个完整产品外壳的造型、颜色和分型一致，不能照抄轴测摄像角度。"
                : "") +
              "\n纯外观组硬性约束：只画正常使用状态的完整不透明成品外壳，不显示主板、PCB、芯片、电池、排针内部根部或任何内部零件；不剖切、不爆炸、不透明透视，不为展示内部零件开大观察窗。可以保留正常外部接口、按钮和细分型线，开口内不刻画内部元件。干净纯白背景，不画工程底图、尺寸线、尺寸数值、文字或品牌标识，不把零件图叠到背景。外观尺寸仅作为比例约束，不能视为工程验证。\n功能忠实约束：原始prompt没有明确正面要求的摄像头、镜头、显示屏、按钮、指示灯、装饰孔一个也不画，不得为了美观新增功能或开孔；不得把产品外壳画成相机、手机等其他产品。只保留原始prompt明确指定的外部接口，未指定功能的面必须是完整素面。\n最高优先视角要求：" +
              cameras[request.view] +
              ratio;
            const asset = await store.generate(
              {
                ...request,
                prompt,
                ...(envelope
                  ? {
                      envelopeMm: envelope.properties.dimensionsMm as [
                        number,
                        number,
                        number,
                      ],
                      envelopeItemId: envelope.id,
                    }
                  : {}),
              },
              first,
            );
            results.set(item.id, asset);
            await observe(asset, item.id);
            await audit({
              tool: "generate_product_images",
              success: true,
              source: asset.model,
              query: request.view,
            });
          } catch (error) {
            const message = (error as Error).message;
            failures.set(item.id, message);
            await audit({
              tool: "generate_product_images",
              success: false,
              query: String(item.properties.view),
              error: message,
            });
            throw error;
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                images: args.requestIds.map((id) => ({
                  itemId: `image:${results.get(id)!.id}`,
                  ...results.get(id)!,
                })),
                engineeringVerified: false,
              }),
            },
          ],
          details: {},
        };
      },
    }),
  ];
}

export function validateImageOutput(packet: Packet, evidence: Packet[]) {
  const assets = evidence
    .flatMap((p) => p.data.structure)
    .filter((i) => i.kind === "generated-image");
  for (const channel of channels)
    for (const item of packet.data[channel]) {
      if (item.kind === "generated-image")
        throw new Error(
          "generated-image只能由真实生图执行器创建，不可在模型输出中伪造",
        );
      if (
        item.properties.imageUrl !== undefined &&
        !assets.some((a) => a.properties.imageUrl === item.properties.imageUrl)
      )
        throw new Error(
          "图像URL没有对应的真实执行证据，请使用generate_product_images，不能虚构图片链接",
        );
    }
}
