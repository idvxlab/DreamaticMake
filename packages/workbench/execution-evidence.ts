import { channels, type Invocation, type Packet } from "./contracts";

export function visualTaskRequirements(instruction: string) {
  const executionClauses = instruction
    .split(/[。；;\n，]/)
    .filter(
      (clause) =>
        !/(?:不|暂不|无需|不必|禁止|不要|尚未).{0,6}(?:执行|生成|渲染|调用)/.test(
          clause,
        ) && !/(?:请求|提示词|规范)(?:条目)?$/.test(clause.trim()),
    )
    .filter((clause) =>
      /执行.{0,40}(?:生图|外观|轮廓|image-request)|(?:生成|渲染).{0,20}(?:效果图|外观图|侧视图|正视图|俯视图|轴测图|轮廓三视图|正投影)|(?:generate|render).{0,20}(?:image|views|projection)|(?:调用|使用).{0,15}(?:generate_product_images|render_component_views|build_appearance_geometry)/i.test(
        clause,
      ),
    );
  return executionClauses.join(" ");
}

/** Model prose is a proposal; execution completion requires tool-owned image evidence. */
export function validateVisualExecution(
  node: Invocation,
  packet: Packet,
  inputs: Packet[],
  instruction: string,
) {
  if (node.role !== "designer") return;
  const own = (node.imageEvidence || [])
    .flatMap((p) => p.data.structure)
    .filter((i) => i.kind === "generated-image");
  const inherited = inputs
    .flatMap((p) => p.data.structure)
    .filter((i) => i.kind === "generated-image");
  const items = channels.flatMap((c) => packet.data[c]);
  const claims = [
    packet.summary,
    ...items
      .filter((i) => ["render-result", "execution-note"].includes(i.kind))
      .map((i) => JSON.stringify(i.properties)),
  ];
  const positiveClaims = claims.flatMap((s) =>
    [
      ...s.matchAll(
        /(?:已|已经|成功).{0,50}?(?:执行.{0,12}?(?:生图|渲染|图片|轮廓)|生成.{0,12}?(?:外观图|效果图|图片|三视图|正投影|轮廓图)|完成.{0,12}?(?:生图|渲染|图片|投影))/g,
      ),
    ]
      .filter(
        (m) =>
          !/(?:未|尚未|不能|无法|待).{0,8}(?:生成|完成|执行|渲染|产出)/.test(
            m[0],
          ) &&
          !/^(?:像)?(?:的|生成)?(?:请求|提示词|规范)/.test(
            s.slice((m.index || 0) + m[0].length),
          ),
      )
      .map((m) => m[0]),
  );
  const englishClaims = claims.flatMap((s) =>
    [
      ...s.matchAll(
        /\b(?:successfully\s+)?(?:generated|rendered|produced)\b.{0,40}\b(?:image|view|render|projection)/gi,
      ),
    ].map((m) => m[0]),
  );
  const structuredClaims = items.filter(
    (i) =>
      ["render-result", "execution-note"].includes(i.kind) &&
      (i.properties.renderer === "render_component_views" ||
        i.properties.executed === true ||
        i.properties.generated === true ||
        ["completed", "executed", "success"].includes(
          String(i.properties.status),
        )),
  );
  const positive =
    positiveClaims.length > 0 ||
    englishClaims.length > 0 ||
    structuredClaims.length > 0;
  // A negative instruction about the other image set must not cancel execution
  // of the requested set (e.g. generate the side view, do not render internals).
  const execution = visualTaskRequirements(instruction);
  const explicit = execution.length > 0;
  const describesLayout = /轮廓|零件布置|render_component_views/i.test(
    [
      ...positiveClaims,
      ...englishClaims,
      ...structuredClaims.map((i) => JSON.stringify(i.properties)),
    ].join(" "),
  );
  const describesAppearance =
    /生图|外观图|效果图|generate_product_images/i.test(
      [
        ...positiveClaims,
        ...englishClaims,
        ...structuredClaims.map((i) => JSON.stringify(i.properties)),
      ].join(" "),
    );
  const available = [...own, ...inherited];
  const failure = node.toolActivity
    ?.filter(
      (t) =>
        !t.success &&
        /build_appearance_geometry|render_component_views|generate_product_images/.test(
          t.tool,
        ),
    )
    .at(-1);
  if ((positive || explicit) && !own.length && failure)
    throw new Error(
      `图片/几何执行失败（${failure.tool}）：${failure.error?.trim().split("\n").at(-1)?.slice(-1200) || "缺少执行产物"}`,
    );
  if (positive && !own.length && !inherited.length)
    throw new Error(
      "声称完成图片或轮廓生成，但没有实际工具图片证据；请调用执行工具或如实返回待生成",
    );
  if (
    positive &&
    describesLayout &&
    !available.some((i) => i.properties.imageSet === "component_layout")
  )
    throw new Error("声称完成零件轮廓图，但没有对应的真实轮廓图片证据");
  if (
    positive &&
    describesAppearance &&
    !available.some((i) => i.properties.imageSet === "appearance")
  )
    throw new Error("声称完成外观图，但没有对应的真实外观图片证据");
  if (explicit && !own.length)
    throw new Error(
      "本次图片执行任务没有生成实际产物；请使用真实执行工具，不得将请求或文字当成完成",
    );
  if (
    explicit &&
    /轮廓|零件布置|render_component_views/i.test(execution) &&
    !own.some((i) => i.properties.imageSet === "component_layout")
  )
    throw new Error("本次未生成要求的零件轮廓图片");
  if (
    explicit &&
    (/生图|外观|效果图|轴测图|generate_product_images|build_appearance_geometry/i.test(
      execution,
    ) ||
      (!/零件|轮廓|render_component_views/i.test(execution) &&
        /侧视图|正视图|俯视图/i.test(execution))) &&
    !own.some((i) => i.properties.imageSet === "appearance")
  )
    throw new Error("本次未生成要求的纯外观图片");
  if (
    explicit &&
    /(?:四|4).{0,6}(?:条|张|幅|视图)/.test(execution) &&
    /外观|生图|generate_product_images/i.test(execution)
  ) {
    const views = new Set(
      available
        .filter((i) => i.properties.imageSet === "appearance")
        .map((i) => i.properties.view),
    );
    if (!["perspective", "front", "top", "side"].every((v) => views.has(v)))
      throw new Error(
        "外观四视图尚未全部生成；已生成的图片会保留，不能称整组完成",
      );
  }
  if (
    explicit &&
    /(?:三视图|三张|3张)/.test(execution) &&
    /轮廓|零件布置|render_component_views/i.test(execution)
  ) {
    const views = new Set(
      own
        .filter((i) => i.properties.imageSet === "component_layout")
        .map((i) => i.properties.view),
    );
    if (!["front", "top", "side"].every((v) => views.has(v)))
      throw new Error("零件轮廓三视图尚未全部生成");
  }
}
