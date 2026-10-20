import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  hash,
  HttpError,
  Store,
  validId,
  within,
} from "../../../packages/core/src/store";
import { replaceFile } from "../../../packages/core/src/atomic-file";
import type { EngineMeshAsset } from "../../../packages/core/src/design-engine";

export const meshUploadSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(160)
      .regex(/\.stl$/i),
    unit: z.enum(["mm", "cm", "m"]),
    data: z
      .string()
      .min(4)
      .max(6_666_668)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((value) => value.length % 4 === 0),
  })
  .strict();
const triple = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const meshModelSchema = z
  .object({
    contextKey: z.string().regex(/^[a-f0-9]{64}$/),
    meshes: z
      .array(
        z
          .object({
            assetId: z.string().uuid(),
            unit: z.enum(["mm", "cm", "m"]),
            collisionMode: z.enum(["surface", "solid"]),
            position: triple,
            rotation: triple, // Euler XYZ degrees, converted once to xyzw by the host.
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();

export class MeshLibrary {
  constructor(private store: Store) {}
  private folder(id: string) {
    return join(this.store.dir(id), "uploads", "engine-meshes");
  }
  async list(id: string): Promise<EngineMeshAsset[]> {
    await this.store.get(id);
    try {
      const files = (await readdir(this.folder(id))).filter((f) =>
        /^[a-f0-9-]{36}\.json$/.test(f),
      );
      return Promise.all(
        files.map(async (name) =>
          JSON.parse(await readFile(join(this.folder(id), name), "utf8")),
        ),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async get(id: string, assetId: string) {
    await this.store.get(id);
    validId(assetId);
    try {
      const root = await realpath(this.folder(id));
      const metaPath = within(
        root,
        await realpath(join(root, assetId + ".json")),
      );
      const metadata: EngineMeshAsset = JSON.parse(
        await readFile(metaPath, "utf8"),
      );
      if (!/^[a-f0-9]{64}$/.test(metadata.sha256) || metadata.id !== assetId)
        throw new HttpError(409, "STL 资产记录异常");
      const path = within(root, await realpath(join(root, assetId + ".stl")));
      const bytes = await readFile(path);
      if (
        bytes.length > 5_000_000 ||
        bytes.length !== metadata.bytes ||
        hash(bytes) !== metadata.sha256
      )
        throw new HttpError(409, "STL 资产哈希或大小不匹配");
      return { metadata, bytes };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new HttpError(404, "STL 资产不存在于当前项目");
      throw e;
    }
  }
  async save(
    id: string,
    input: z.infer<typeof meshUploadSchema>,
    inspection: Record<string, unknown>,
  ) {
    const bytes = Buffer.from(input.data, "base64");
    const digest = hash(bytes),
      assetId = randomUUID();
    if (bytes.length > 5_000_000 || inspection.sha256 !== digest)
      throw new HttpError(400, "STL 检查结果不匹配");
    const metadata = {
      ...inspection,
      id: assetId,
      name: input.name,
      unit: input.unit,
      bytes: bytes.length,
      sha256: digest,
      createdAt: new Date().toISOString(),
      assetVersion: 1,
    } as EngineMeshAsset;
    await this.store.update(id, async () => {
      const folder = this.folder(id);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, assetId + ".stl"), bytes, { flag: "wx" });
      const tmp = join(folder, assetId + ".tmp");
      await writeFile(tmp, JSON.stringify(metadata), { flag: "wx" });
      await replaceFile(tmp, join(folder, assetId + ".json"));
    });
    return metadata;
  }
  async inlineAssets(id: string, bundle: Record<string, unknown>) {
    const assets: Record<string, string> = {};
    let size = 0;
    // Explicitly handle mesh shapes only. No recursively discovered arbitrary path imports.
    const components = Array.isArray(bundle.components)
      ? bundle.components
      : [];
    for (const component of components) {
      for (const value of Object.values(
        component?.physical?.geometry?.envelopes ?? {},
      )) {
        const shape = (value as { shape?: Record<string, any> })?.shape;
        if (shape?.kind !== "triangle_mesh") continue;
        const ref = z
          .object({
            artifact_id: z.string().uuid(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            relative_path: z.null().optional(),
            media_type: z.literal("model/stl"),
          })
          .strict()
          .parse(shape.asset_ref);
        const { bytes, metadata } = await this.get(id, ref.artifact_id);
        if (metadata.sha256 !== ref.sha256)
          throw new HttpError(409, "STL 引用哈希不匹配");
        if (assets[ref.sha256]) continue;
        size += bytes.length;
        if (size > 8_000_000 || Object.keys(assets).length >= 32)
          throw new HttpError(
            413,
            "模型引用的 STL 总大小超限（8 MB / 32 个资产）",
          );
        assets[ref.sha256] = bytes.toString("base64");
      }
    }
    return assets;
  }
}
