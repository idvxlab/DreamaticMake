import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { stages, type Project } from "../../../packages/core/src/contracts";
import type {
  EngineRecord,
  EngineReply,
  EngineState,
} from "../../../packages/core/src/design-engine";
import {
  hash,
  HttpError,
  Store,
  validId,
} from "../../../packages/core/src/store";
import { inputHash } from "../../../packages/core/src/workflow";
import { Settings } from "../../../packages/core/src/settings";
import { runProcess } from "../../../packages/core/src/worker";
import { replaceFile } from "../../../packages/core/src/atomic-file";
import { MeshLibrary, meshUploadSchema, meshModelSchema } from "./mesh-assets";

const requestSchema = z
  .object({
    method: z.enum(["validate", "preview", "workspace"]),
    bundle: z.record(z.string(), z.unknown()),
    scenario: z.record(z.string(), z.unknown()).optional(),
    contextKey: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const engineContextKey = (p: Project) =>
  hash(stages.map((s) => inputHash(p, s)));

/** A bounded, credential-free process per request; never publishes approvals or BOMs. */
export class DesignEngine {
  private active = new Map<string, AbortController>();
  readonly meshes: MeshLibrary;
  constructor(
    private root: string,
    private store: Store,
    private settings: Settings,
    private execute: typeof runProcess = runProcess,
  ) {
    this.meshes = new MeshLibrary(store);
  }

  private async meshTask<T>(
    id: string,
    task: (controller: AbortController) => Promise<T>,
    signal?: AbortSignal,
  ) {
    if (this.active.has(id) || this.active.size >= 2)
      throw new HttpError(409, "设计引擎忙，请稍后重试");
    const controller = new AbortController();
    this.active.set(id, controller);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      return await task(controller);
    } finally {
      this.active.delete(id);
      signal?.removeEventListener("abort", cancel);
    }
  }

  private async meshCommand(
    method: "inspect_stl" | "mesh_bundle",
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const config = await this.settings.snapshot(),
      requestId = randomUUID();
    const python = config.MAKE_ENGINE_PYTHON;
    let result;
    try {
      result = await this.execute(
        /[\\/]/.test(python) ? resolve(this.root, python) : python,
        ["-B", "-m", "engine", "request"],
        {
          cwd: this.root,
          input: JSON.stringify({ request_id: requestId, method, ...input }),
          timeout: 60000,
          signal,
          env: { PYTHONIOENCODING: "utf-8" },
        },
      );
    } catch {
      throw new HttpError(
        503,
        "STL 处理失败或已取消，请安装 engine/requirements-mesh.txt 并检查引擎 Python 设置",
      );
    }
    let reply;
    try {
      reply = JSON.parse(result.stdout);
    } catch {
      throw new HttpError(503, "STL 处理进程返回异常");
    }
    if (reply.request_id !== requestId || ![0, 2].includes(result.code))
      throw new HttpError(503, "STL 处理进程返回异常");
    if (reply.type === "error")
      throw new HttpError(
        422,
        (reply.diagnostics ?? [])
          .map((d: { message: string }) => d.message)
          .join("; ")
          .slice(0, 2000),
      );
    if (reply.type !== "result" || !reply.payload)
      throw new HttpError(503, "STL 处理进程返回异常");
    return reply.payload;
  }

  async uploadMesh(id: string, input: unknown, signal?: AbortSignal) {
    const data = meshUploadSchema.parse(input);
    return this.meshTask(
      id,
      async (controller) => {
        await this.store.get(id);
        const inspection = await this.meshCommand(
          "inspect_stl",
          { data: data.data, unit: data.unit },
          controller.signal,
        );
        if (controller.signal.aborted)
          throw new HttpError(409, "引擎任务已取消");
        return this.meshes.save(id, data, inspection);
      },
      signal,
    );
  }

  async meshModel(id: string, input: unknown, signal?: AbortSignal) {
    const data = meshModelSchema.parse(input);
    return this.meshTask(
      id,
      async (controller) => {
        if (engineContextKey(await this.store.get(id)) !== data.contextKey)
          throw new HttpError(409, "项目输入已变化，请刷新设计引擎");
        const entries = [];
        for (const [i, item] of data.meshes.entries()) {
          const { metadata } = await this.meshes.get(id, item.assetId);
          if (item.collisionMode === "solid" && !metadata.volume_candidate)
            throw new HttpError(400, "该 STL 不能用于封闭实体模式");
          const [x, y, z] = item.rotation.map((v) => (v * Math.PI) / 360);
          const [cx, cy, cz, sx, sy, sz] = [
            Math.cos(x),
            Math.cos(y),
            Math.cos(z),
            Math.sin(x),
            Math.sin(y),
            Math.sin(z),
          ];
          entries.push({
            id: `mesh_${i + 1}`,
            shape: {
              kind: "triangle_mesh",
              unit: item.unit,
              collision_mode: item.collisionMode,
              asset_ref: {
                artifact_id: metadata.id,
                sha256: metadata.sha256,
                media_type: "model/stl",
              },
            },
            world_pose: {
              translation_m: item.position,
              rotation_xyzw: [
                sx * cy * cz + cx * sy * sz,
                cx * sy * cz - sx * cy * sz,
                cx * cy * sz + sx * sy * cz,
                cx * cy * cz - sx * sy * sz,
              ],
            },
          });
        }
        const documents = await this.meshCommand(
          "mesh_bundle",
          { meshes: entries },
          controller.signal,
        );
        if (engineContextKey(await this.store.get(id)) !== data.contextKey)
          throw new HttpError(409, "项目输入已变化，请刷新设计引擎");
        return documents;
      },
      signal,
    );
  }
  isBusy(id: string) {
    return this.active.has(id);
  }
  abort(id: string) {
    this.active.get(id)?.abort();
  }
  async state(id: string): Promise<EngineState> {
    const contextKey = engineContextKey(await this.store.get(id));
    try {
      const folder = join(this.store.dir(id), "jobs", "design-engine");
      const latest = validId(
        (await readFile(join(folder, "latest"), "utf8")).trim(),
      );
      const record: EngineRecord = JSON.parse(
        await readFile(join(folder, latest + ".json"), "utf8"),
      );
      return { contextKey, record, stale: record.contextKey !== contextKey };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { contextKey, record: null, stale: false };
    }
  }
  async example(name: string) {
    if (!["actuator", "fan", "lamp"].includes(name))
      throw new HttpError(404, "引擎示例不存在");
    const folder = join(this.root, "engine", "examples");
    return {
      bundle: JSON.parse(
        await readFile(join(folder, name + ".bundle.json"), "utf8"),
      ),
      scenario: JSON.parse(
        await readFile(join(folder, name + ".scenario.json"), "utf8"),
      ),
    };
  }
  async request(
    id: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<EngineState> {
    const data = requestSchema.parse(input);
    if (this.active.has(id) || this.active.size >= 2)
      throw new HttpError(409, "设计引擎忙，请稍后重试");
    const controller = new AbortController();
    this.active.set(id, controller);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const project = await this.store.get(id);
      if (project.running) throw new HttpError(409, "请等待项目任务结束");
      if (engineContextKey(project) !== data.contextKey)
        throw new HttpError(409, "项目输入已变化，请刷新设计引擎");
      const bindings = z
        .record(z.string(), z.number().int().positive())
        .parse(data.bundle.input_revisions ?? {});
      for (const [stage, revision] of Object.entries(bindings)) {
        // The bundled examples explicitly identify their assumed fixture revision.
        if (stage === "synthetic-fixture" && revision === 1) continue;
        if (
          !stages.includes(stage as (typeof stages)[number]) ||
          project.stages[stage as (typeof stages)[number]].revision !== revision
        )
          throw new HttpError(409, "模型引用的项目阶段版本已过期或无法识别");
      }
      if (data.method !== "validate" && !data.scenario)
        throw new HttpError(400, "预览和仿真需要场景文件");
      const config = await this.settings.snapshot();
      const python = config.MAKE_ENGINE_PYTHON;
      const requestId = randomUUID();
      const assets = await this.meshes.inlineAssets(id, data.bundle);
      const workerInput = JSON.stringify({
        request_id: requestId,
        method: data.method,
        bundle: data.bundle,
        scenario: data.scenario,
        assets,
      });
      if (Buffer.byteLength(workerInput) > 16 * 1024 * 1024)
        throw new HttpError(413, "引擎输入及资产总大小超限");
      let result;
      try {
        result = await this.execute(
          /[\\/]/.test(python) ? resolve(this.root, python) : python,
          ["-B", "-m", "engine", "request"],
          {
            cwd: this.root,
            input: workerInput,
            timeout: Math.min(+config.MAKE_WORKER_TIMEOUT * 1000, 120000),
            signal: controller.signal,
            env: { PYTHONIOENCODING: "utf-8" },
          },
        );
      } catch {
        throw new HttpError(
          503,
          controller.signal.aborted
            ? "引擎任务已取消"
            : "设计引擎不可用、超时或输出超限，请检查引擎 Python 设置（Python 3.11+ / Pydantic 2）",
        );
      }
      let reply: EngineReply;
      try {
        reply = JSON.parse(result.stdout);
        if (
          ![0, 2].includes(result.code) ||
          reply.request_id !== requestId ||
          !["result", "error"].includes(reply.type)
        )
          throw new Error();
        if (reply.type === "result" && !reply.payload?.snapshot_id)
          throw new Error();
        if (reply.type === "error" && !Array.isArray(reply.diagnostics))
          throw new Error();
      } catch {
        throw new HttpError(
          503,
          "设计引擎返回异常，请检查引擎 Python 设置（Python 3.11+ / Pydantic 2）",
        );
      }
      const record: EngineRecord = {
        adapterVersion: 1,
        id: requestId,
        createdAt: new Date().toISOString(),
        contextKey: data.contextKey,
        method: data.method,
        bundle: data.bundle,
        scenario: data.scenario,
        reply,
      };
      // Serialize publication with Context edits. Changed inputs cannot become the latest result.
      await this.store.update(id, async (current) => {
        if (controller.signal.aborted)
          throw new HttpError(409, "引擎任务已取消");
        if (engineContextKey(current) !== data.contextKey)
          throw new HttpError(409, "项目输入已变化，本次引擎结果未发布");
        const folder = join(this.store.dir(id), "jobs", "design-engine");
        await mkdir(folder, { recursive: true });
        await writeFile(
          join(folder, requestId + ".json"),
          JSON.stringify(record),
          { flag: "wx" },
        );
        const temporary = join(folder, requestId + ".tmp");
        await writeFile(temporary, requestId);
        await replaceFile(temporary, join(folder, "latest"));
      });
      return this.state(id);
    } finally {
      signal?.removeEventListener("abort", cancel);
      this.active.delete(id);
    }
  }
}
