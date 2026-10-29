import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { z } from "zod";
import { connectionStore, ConnectionStore } from "./connection";
import { VERSION, type Packet } from "./contracts";
import type { HardwareRef } from "./hardware-contracts";
import type { AppearanceRef } from "./appearance-contracts";

export const imageViews = ["perspective", "front", "top", "side"] as const;
export const imageRequestSchema = z.object({
  imageSet: z.enum(["appearance", "component_layout"]).optional(),
  projection: z.enum(["axonometric", "orthographic"]).optional(),
  envelopeMm: z
    .tuple([
      z.number().positive(),
      z.number().positive(),
      z.number().positive(),
    ])
    .optional(),
  envelopeItemId: z.string().max(240).optional(),
  view: z.enum(imageViews),
  prompt: z.string().trim().min(10).max(18000),
  label: z.string().min(1).max(120),
});
export type ImageRequest = z.infer<typeof imageRequestSchema>;
export type ImageAsset = ImageRequest & {
  version: "dreamatic.image/1";
  id: string;
  model: string;
  createdAt: string;
  sha256: string;
  mime: string;
  width: number;
  height: number;
  imageUrl: string;
  inputDigest: string;
  referenceAssetId?: string;
  hardwareImageReference?: HardwareRef & { assetId: string; sha256: string };
  generationMethod?:
    | "image_model"
    | "geometry_projection"
    | "appearance_geometry";
  appearanceRef?: AppearanceRef;
  geometryDigest?: string;
  geometryConsistent?: boolean;
  layoutFit?: {
    passed: boolean;
    scope: string;
    parts: unknown[];
    pairs: unknown[];
    assemblyVerified: false;
  };
  layoutSourceInvocationId?: string;
  geometryReferences?: unknown[];
  engineeringVerified: false;
};
export type HardwareImageInput = {
  bytes: Buffer;
  mime: string;
  reference: NonNullable<ImageAsset["hardwareImageReference"]>;
};
const MAX_IMAGE = 24 * 1024 * 1024;
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

async function bounded(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("图像服务返回空响应");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw new Error("图像服务响应过大");
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export function imageInfo(bytes: Buffer) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return {
      mime: "image/png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i++] !== 255) break;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 217 || marker === 218) break;
      const length = bytes.readUInt16BE(i);
      if (length < 2 || i + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      )
        return {
          mime: "image/jpeg",
          height: bytes.readUInt16BE(i + 3),
          width: bytes.readUInt16BE(i + 5),
        };
      i += length;
    }
  }
  if (
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.toString("ascii", 12, 16) === "VP8X"
  )
    return {
      mime: "image/webp",
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    };
  throw new Error("返回内容不是受支持的PNG、JPEG或WebP图片，未当作成功产物");
}
const publicAddress = (address: string) => {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a !== 0 &&
      a !== 10 &&
      a !== 127 &&
      a < 224 &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && b === 168) &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 198 && (b === 18 || b === 19))
    );
  }
  return isIP(address) === 6 && /^[23][0-9a-f]{0,3}:/i.test(address);
};

export class ImageStore {
  constructor(
    private directory = resolve("workspace/workbench/images"),
    private connections: ConnectionStore = connectionStore,
    private fetcher: typeof fetch = fetch,
  ) {}
  private manifest(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("图像资产ID无效");
    return resolve(this.directory, id + ".json");
  }
  async read(id: string) {
    const asset = JSON.parse(
      await readFile(this.manifest(id), "utf8"),
    ) as ImageAsset;
    if (asset.id !== id || !/^[a-f0-9]{64}$/.test(asset.sha256))
      throw new Error("图像资产记录无效");
    const bytes = await readFile(resolve(this.directory, id + ".bin"));
    if (bytes.length > MAX_IMAGE || digest(bytes) !== asset.sha256)
      throw new Error("图像资产SHA-256不匹配");
    const info = imageInfo(bytes);
    if (
      info.width !== asset.width ||
      info.height !== asset.height ||
      info.mime !== asset.mime
    )
      throw new Error("图像资产格式不匹配");
    return { asset, bytes };
  }
  async generate(
    raw: ImageRequest,
    reference?: ImageAsset,
    hardware?: HardwareImageInput,
  ): Promise<ImageAsset> {
    const request = imageRequestSchema.parse(raw);
    if (request.imageSet === "component_layout")
      throw new Error("零件布置组必须由真实几何投影，不使用图片模型猜测布局");
    if (request.imageSet === "appearance" && hardware)
      throw new Error("纯外观组不得传入主板照片作为参考");
    if (request.imageSet === "appearance")
      request.projection =
        request.view === "perspective" ? "axonometric" : "orthographic";
    request.label =
      request.label.replace(/待生成规范|待生成|生图规范/g, "").trim() ||
      request.view;
    const config = await this.connections.read();
    if (!config?.imageModel)
      throw new Error("请在模型设置选择专用生图模型；当前未配置图片执行器");
    const inputDigest = digest(
      JSON.stringify({
        request,
        model: config.imageModel,
        baseUrl: config.baseUrl,
        reference: reference?.sha256,
        hardware: hardware?.reference,
      }),
    );
    await mkdir(this.directory, { recursive: true });
    const cache = resolve(this.directory, inputDigest + ".cache");
    try {
      return (await this.read((await readFile(cache, "utf8")).trim())).asset;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const referenceData = reference ? await this.read(reference.id) : undefined;
    if (
      hardware &&
      (hardware.bytes.length > MAX_IMAGE ||
        digest(hardware.bytes) !== hardware.reference.sha256 ||
        imageInfo(hardware.bytes).mime !== hardware.mime)
    )
      throw new Error("硬件参考图片与源文件哈希或格式不符");
    const inputImages = [
      ...(referenceData
        ? [
            `data:${referenceData.asset.mime};base64,${referenceData.bytes.toString("base64")}`,
          ]
        : []),
      ...(hardware
        ? [`data:${hardware.mime};base64,${hardware.bytes.toString("base64")}`]
        : []),
    ];
    let response: Response;
    try {
      response = await this.fetcher(config.baseUrl + "/images/generations", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(240000),
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.imageModel,
          prompt: request.prompt,
          size: "2048x2048",
          response_format: "b64_json",
          n: 1,
          ...(inputImages.length
            ? { image: inputImages.length === 1 ? inputImages[0] : inputImages }
            : {}),
        }),
      });
    } catch {
      throw new Error(
        "生图服务连接失败或超时，未产生成功图像；请检查网关图片接口",
      );
    }
    if (!response.ok) {
      const body = (await bounded(response, 10000)).toString("utf8");
      let message = "";
      try {
        message = String(JSON.parse(body)?.error?.message || "");
      } catch {}
      message = message.split(config.apiKey).join("[redacted]").slice(0, 400);
      throw new Error(
        `生图失败（HTTP ${response.status}）${message ? "：" + message : ""}`,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(
        (await bounded(response, MAX_IMAGE * 1.5)).toString("utf8"),
      );
    } catch {
      throw new Error("生图服务未返回有效且有界的JSON产物");
    }
    const result = z
      .object({
        data: z
          .array(
            z.object({
              b64_json: z.string().optional(),
              url: z.string().optional(),
            }),
          )
          .min(1)
          .max(4),
      })
      .parse(json).data[0];
    let bytes: Buffer;
    if (result.b64_json) {
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(result.b64_json))
        throw new Error("图像Base64无效");
      bytes = Buffer.from(result.b64_json, "base64");
    } else if (result.url) {
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hostname.endsWith(".local")
      )
        throw new Error("生图服务返回了不支持的下载地址");
      const addresses = await lookup(url.hostname, { all: true });
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw new Error("生图下载地址不能指向本机或私网");
      // Download without forwarding the gateway credential to a CDN.
      const image = await this.fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
      if (!image.ok) throw new Error(`图像下载失败（HTTP ${image.status}）`);
      bytes = await bounded(image, MAX_IMAGE);
    } else throw new Error("生图响应没有图像数据，未将文字当作图片");
    if (bytes.length > MAX_IMAGE) throw new Error("图片超过24MB限制");
    const info = imageInfo(bytes);
    if (
      info.width < 64 ||
      info.height < 64 ||
      info.width > 8192 ||
      info.height > 8192
    )
      throw new Error("图片尺寸无效");
    const id = randomUUID();
    const asset: ImageAsset = {
      version: "dreamatic.image/1",
      ...request,
      id,
      model: config.imageModel,
      createdAt: new Date().toISOString(),
      sha256: digest(bytes),
      ...info,
      imageUrl: `/workbench-api/images/${id}`,
      inputDigest,
      ...(reference ? { referenceAssetId: reference.id } : {}),
      ...(hardware ? { hardwareImageReference: hardware.reference } : {}),
      engineeringVerified: false,
      generationMethod: "image_model",
      geometryConsistent: false,
    };
    await writeFile(resolve(this.directory, id + ".bin"), bytes, {
      mode: 0o600,
    });
    await writeFile(this.manifest(id), JSON.stringify(asset, null, 2), {
      mode: 0o600,
    });
    const temp = cache + ".tmp-" + randomUUID();
    await writeFile(temp, id, { mode: 0o600 });
    await rename(temp, cache);
    return asset;
  }
  async saveProjection(
    request: ImageRequest,
    bytes: Buffer,
    sourceInvocationId: string,
    geometryReferences: unknown[],
    inputDigest: string,
    appearance?: {
      reference: AppearanceRef;
      geometryDigest: string;
      fit?: ImageAsset["layoutFit"];
    },
  ): Promise<ImageAsset> {
    if (
      request.imageSet !== "component_layout" ||
      request.view === "perspective"
    )
      throw new Error("零件轮廓仅生成独立的三视图");
    const info = imageInfo(bytes);
    if (bytes.length > MAX_IMAGE || info.width < 64 || info.height < 64)
      throw new Error("轮廓投影产物无效");
    await mkdir(this.directory, { recursive: true });
    const id = randomUUID();
    const asset: ImageAsset = {
      ...request,
      ...info,
      version: "dreamatic.image/1",
      id,
      model: "本地几何正投影",
      createdAt: new Date().toISOString(),
      sha256: digest(bytes),
      imageUrl: `/workbench-api/images/${id}`,
      inputDigest,
      generationMethod: "geometry_projection",
      layoutSourceInvocationId: sourceInvocationId,
      geometryReferences,
      ...(appearance
        ? {
            appearanceRef: appearance.reference,
            geometryDigest: appearance.geometryDigest,
            geometryConsistent: true,
            layoutFit: appearance.fit,
          }
        : {}),
      engineeringVerified: false,
    };
    await writeFile(resolve(this.directory, id + ".bin"), bytes, {
      mode: 0o600,
    });
    await writeFile(this.manifest(id), JSON.stringify(asset, null, 2), {
      mode: 0o600,
    });
    return asset;
  }
  async saveAppearanceView(
    request: ImageRequest,
    bytes: Buffer,
    reference: AppearanceRef,
    geometryDigest: string,
    inputDigest: string,
  ): Promise<ImageAsset> {
    const info = imageInfo(bytes);
    if (bytes.length > MAX_IMAGE || info.width < 64 || info.height < 64)
      throw new Error("外形渲染产物无效");
    await mkdir(this.directory, { recursive: true });
    const id = randomUUID();
    const asset: ImageAsset = {
      ...request,
      ...info,
      version: "dreamatic.image/1",
      id,
      model: "统一外形CAD正交渲染",
      createdAt: new Date().toISOString(),
      sha256: digest(bytes),
      imageUrl: `/workbench-api/images/${id}`,
      inputDigest,
      generationMethod: "appearance_geometry",
      appearanceRef: reference,
      geometryDigest,
      geometryConsistent: true,
      engineeringVerified: false,
    };
    await writeFile(resolve(this.directory, id + ".bin"), bytes, {
      mode: 0o600,
    });
    await writeFile(this.manifest(id), JSON.stringify(asset, null, 2), {
      mode: 0o600,
    });
    return asset;
  }
}
export const imageStore = new ImageStore();
export function imagePacket(asset: ImageAsset): Packet {
  return {
    version: VERSION,
    id: randomUUID(),
    invocationId: "image-generation",
    inputs: [],
    summary: `已生成${asset.label} · ${asset.model}`,
    evidence: "executed",
    execution: {
      tool:
        asset.generationMethod === "appearance_geometry"
          ? "shared appearance CAD orthographic rendering"
          : asset.generationMethod === "geometry_projection"
            ? "local orthographic geometry projection"
            : `gateway images/generations · ${asset.model}`,
      artifact: asset.imageUrl,
      digest: asset.sha256,
    },
    data: {
      structure: [
        {
          id: `image:${asset.id}`,
          kind: "generated-image",
          label: asset.label,
          properties: { ...asset, status: "generated", visualOnly: true },
          references: [],
        },
      ],
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [],
    },
  };
}
