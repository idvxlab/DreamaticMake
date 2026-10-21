import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { z } from "zod";
import {
  Store,
  HttpError,
  within,
  hash,
} from "../../../packages/core/src/store";
import {
  prepareWorkspace,
  workspacePath,
} from "../../../packages/core/src/workspace";
import { Settings } from "../../../packages/core/src/settings";
import {
  Workflow,
  currentStage,
  inputHash,
  invalidate,
} from "../../../packages/core/src/workflow";
import {
  stages,
  answersSchema,
  enclosureSchema,
  type Part,
  type StageId,
} from "../../../packages/core/src/contracts";
import { runProcess } from "../../../packages/core/src/worker";
import { Runtime } from "../../../packages/agent-runtime/src/runtime";
import { roleIds, loadRole } from "../../../packages/agent-runtime/src/roles";
import { Engineering } from "./engineering";
import { DesignEngine } from "./design-engine";
import { AgentEngine } from "./agent-engine";
export const root = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);
const partSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(160),
  manufacturer: z.string().max(160),
  revision: z.string().max(160),
  source: z.string().min(1).max(2000),
  licenseSource: z.string().max(2000),
  openHardware: z.enum(["verified", "unverified"]),
  geometryVerified: z.boolean(),
  dimensions: z.object({
    width: z.number().min(1).max(500),
    depth: z.number().min(1).max(500),
    height: z.number().min(0.1).max(500).nullable(),
  }),
  holes: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        diameter: z.number().positive(),
      }),
    )
    .max(20),
  voltage: z.string().max(1000),
  logic: z.string().max(1000),
  interfaces: z.array(z.string()).max(30),
  notes: z.string().max(5000),
  checkedAt: z.string(),
  engineComponent: z.record(z.string(), z.unknown()).optional(),
});
async function body(req: IncomingMessage) {
  let n = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    n += chunk.length;
    if (n > 12_000_000) throw new HttpError(413, "上传内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new HttpError(400, "无效 JSON");
  }
}
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
export async function createApp(
  workspaceOverride?: string,
  settings = new Settings(root),
) {
  const config = await settings.snapshot();
  const workspace = workspaceOverride
    ? resolve(workspaceOverride)
    : workspacePath(root, config.MAKE_WORKSPACE);
  const system = await prepareWorkspace(workspace);
  let catalog: Part[] = JSON.parse(
    await readFile(join(root, "catalog/parts.json"), "utf8"),
  );
  try {
    const custom: Part[] = JSON.parse(
      await readFile(join(system, "custom-parts.json"), "utf8"),
    );
    catalog = catalog
      .filter((p) => !custom.some((c) => c.id === p.id))
      .concat(custom);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const store = new Store(workspace, catalog);
  await store.initialize();
  const designEngine = new DesignEngine(root, store, settings);
  const workflow = new Workflow(store, catalog),
    engineering = new Engineering(root, store, settings, catalog),
    runtime = new Runtime(root, store, workflow, settings, engineering, {
      agentEngine: new AgentEngine(root, store, designEngine),
    });
  await store.recover();
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "";
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
        throw new HttpError(403, "仅支持本机访问");
      const origin = req.headers.origin;
      if (
        origin &&
        ![
          "http://" + host,
          "http://127.0.0.1:4321",
          "http://localhost:4321",
        ].includes(origin)
      )
        throw new HttpError(403, "来源不允许");
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw new HttpError(403, "不接受跨站请求");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:; frame-src 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
      );
      const url = new URL(req.url ?? "/", "http://" + host),
        path = url.pathname;
      const method = req.method ?? "GET";
      if (path === "/api/health") {
        json(res, { ok: true, pi: "1.3.0", version: "0.1.0" });
        return;
      }
      if (path === "/api/settings") {
        if (method === "GET")
          json(res, {
            ...(await settings.public()),
            activeWorkspace: workspace,
          });
        else if (method === "PUT")
          json(
            res,
            await settings.save(
              z.record(z.string(), z.string()).parse(await body(req)),
            ),
          );
        else throw new HttpError(405, "不支持此方法");
        return;
      }
      if (path === "/api/diagnostics" && method === "POST") {
        const c = await settings.snapshot();
        const out = [];
        for (const [label, command, args] of [
          [
            "CAD",
            resolve(root, c.MAKE_PYTHON),
            ["-c", 'import build123d, trimesh; print("CAD ready")'],
          ],
          ["固件", resolve(root, c.MAKE_PIO), ["--version"]],
        ] as const) {
          try {
            const r = await runProcess(command, [...args], {
              cwd: workspace,
              timeout: 15000,
            });
            out.push({
              label,
              ok: r.code === 0,
              detail: (r.stdout + r.stderr).slice(-1000),
            });
          } catch (e) {
            out.push({ label, ok: false, detail: String(e) });
          }
        }
        json(res, { checks: out, modelConfigured: !!c.MAKE_API_KEY });
        return;
      }
      if (path === "/api/agents" && method === "GET") {
        json(res, await Promise.all(roleIds.map((id) => loadRole(root, id))));
        return;
      }
      const measureMatch = path.match(
        /^\/api\/catalog\/([a-z0-9_-]+)\/measure$/,
      );
      if (measureMatch && method === "PUT") {
        const data = z
          .object({
            height: z.number().min(1).max(100),
            width: z.number().min(1).max(300),
            depth: z.number().min(1).max(300),
            notes: z.string().trim().min(10).max(2000),
          })
          .parse(await body(req));
        const part = catalog.find((p) => p.id === measureMatch[1]);
        if (!part) throw new HttpError(404, "部件不存在");
        part.dimensions = {
          width: data.width,
          depth: data.depth,
          height: data.height,
        };
        part.geometryVerified = true;
        part.notes =
          "用户实测包络：" +
          data.notes +
          "。未录入安装孔，接头/线缆空间需另行设计。";
        part.checkedAt = new Date().toISOString();

        await writeFile(
          join(system, "custom-parts.json"),
          JSON.stringify(catalog, null, 2),
        );
        json(res, part);
        return;
      }
      if (path === "/api/catalog") {
        if (method === "GET") json(res, catalog);
        else if (method === "POST") {
          const data = partSchema.parse(await body(req));
          if (catalog.some((p) => p.id === data.id))
            throw new HttpError(409, "部件 ID 已存在");
          if (data.geometryVerified && !data.dimensions.height)
            throw new HttpError(400, "确认几何需要实测完整包络");
          if (data.openHardware === "verified")
            throw new HttpError(400, "用户导入部件不能自行标为已核验开源许可");
          catalog.push(data);
          await writeFile(
            join(system, "custom-parts.json"),
            JSON.stringify(catalog, null, 2),
          );
          json(res, data, 201);
        } else throw new HttpError(405, "不支持此方法");
        return;
      }
      if (path === "/api/projects") {
        if (method === "GET") {
          const list = await store.list();
          json(
            res,
            list.map(
              ({ id, name, brief, archived, updatedAt, stages, running }) => ({
                id,
                name,
                brief,
                archived,
                updatedAt,
                stages,
                running,
              }),
            ),
          );
        } else if (method === "POST") {
          const data = z
            .object({
              name: z.string().trim().min(1).max(100),
              brief: z.string().trim().min(1).max(16000),
            })
            .parse(await body(req));
          json(res, await store.create(data.name, data.brief), 201);
        } else throw new HttpError(405, "不支持此方法");
        return;
      }
      const match = path.match(
        /^\/api\/projects\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/,
      );
      if (match) {
        const [, id, action = ""] = match;
        let p = await store.get(id);
        if (action === "engine/meshes" && method === "GET") {
          json(res, await designEngine.meshes.list(id));
          return;
        }
        const meshFile = action.match(/^engine\/meshes\/([a-f0-9-]{36})$/);
        if (meshFile && method === "GET") {
          const { bytes } = await designEngine.meshes.get(id, meshFile[1]);
          res.writeHead(200, {
            "Content-Type": "model/stl",
            "Cache-Control": "no-store",
          });
          res.end(bytes);
          return;
        }
        if (
          ["engine/meshes", "engine/mesh-model"].includes(action) &&
          method === "POST"
        ) {
          const input = await body(req),
            controller = new AbortController();
          const cancel = () => controller.abort();
          res.once("close", cancel);
          try {
            json(
              res,
              action === "engine/meshes"
                ? await designEngine.uploadMesh(id, input, controller.signal)
                : await designEngine.meshModel(id, input, controller.signal),
            );
          } finally {
            res.off("close", cancel);
          }
          return;
        }
        if (action === "engine" && method === "GET") {
          json(res, await designEngine.state(id));
          return;
        }
        if (action.startsWith("engine/examples/") && method === "GET") {
          json(
            res,
            await designEngine.example(action.slice("engine/examples/".length)),
          );
          return;
        }
        if (action === "engine/cancel" && method === "POST") {
          designEngine.abort(id);
          json(res, { ok: true });
          return;
        }
        if (action === "engine" && method === "POST") {
          if (engineering.isBusy(id))
            throw new HttpError(409, "请等待项目任务结束");
          const input = await body(req);
          const controller = new AbortController();
          const cancel = () => controller.abort();
          res.once("close", cancel);
          try {
            json(res, await designEngine.request(id, input, controller.signal));
          } finally {
            res.off("close", cancel);
          }
          return;
        }
        if (action === "catalog" && method === "GET") {
          json(res, await workflow.catalogFor(id));
          return;
        }
        const projectMeasure = action.match(
          /^catalog\/([a-z0-9_-]+)\/measure$/,
        );
        if (projectMeasure && method === "PUT") {
          if (p.running || engineering.isBusy(id))
            throw new HttpError(409, "请等待项目任务结束");
          const data = z
            .object({
              height: z.number().min(1).max(100),
              width: z.number().min(1).max(300),
              depth: z.number().min(1).max(300),
              notes: z.string().trim().min(10).max(2000),
            })
            .parse(await body(req));
          const parts = await workflow.catalogFor(id),
            part = parts.find((part) => part.id === projectMeasure[1]);
          if (!part) throw new HttpError(404, "部件不存在");
          part.dimensions = {
            width: data.width,
            depth: data.depth,
            height: data.height,
          };
          part.geometryVerified = true;
          part.notes =
            "用户实测包络：" +
            data.notes +
            "。未录入安装孔，接头/线缆空间需另行设计。";
          part.checkedAt = new Date().toISOString();
          await store.update(id, async (project) => {
            await store.saveCatalog(id, parts);
            if (project.selectedParts.includes(part.id))
              invalidate(project, "hardware");
          });
          json(res, part);
          return;
        }
        if (action === "events" && method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const cursor = Number(
            req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0,
          );
          let delivered = Number.isFinite(cursor) ? cursor : 0;
          let replaying = true;
          const pending: any[] = [];
          const send = (e: any) => {
            if (e.type === "project.deleted") {
              res.write(`data: ${JSON.stringify(e)}\n\n`);
              res.end();
              return;
            }
            if (e.sequence <= delivered) return;
            delivered = e.sequence;
            res.write(`id: ${e.sequence}\ndata: ${JSON.stringify(e)}\n\n`);
          };
          const listener = (e: any) => {
            if (replaying) pending.push(e);
            else send(e);
          };
          store.events.on(id, listener);
          for (const e of await store.history(id)) send(e);
          replaying = false;
          for (const e of pending) send(e);
          const heartbeat = setInterval(() => res.write(": ping\n\n"), 20000);
          req.on("close", () => {
            clearInterval(heartbeat);
            store.events.off(id, listener);
          });
          return;
        }
        if (action === "" && method === "GET") {
          json(res, {
            ...p,
            projectPath: store.dir(id),
            currentStage: currentStage(p),
            hashes: Object.fromEntries(stages.map((s) => [s, inputHash(p, s)])),
          });
          return;
        }
        if (action === "" && method === "DELETE") {
          const data = z
            .object({ confirmName: z.string().min(1).max(100) })
            .strict()
            .parse(await body(req));
          if (p.running || engineering.isBusy(id) || designEngine.isBusy(id))
            throw new HttpError(409, "请先停止项目任务");
          await store.delete(id, data.confirmName);
          json(res, { ok: true });
          return;
        }
        if (action === "" && method === "PATCH") {
          const data = z
            .object({
              name: z.string().trim().min(1).max(100).optional(),
              archived: z.boolean().optional(),
            })
            .strict()
            .parse(await body(req));
          if (p.running || engineering.isBusy(id))
            throw new HttpError(409, "请先停止任务");
          await store.update(id, (p) => Object.assign(p, data));
          json(res, { ok: true });
          return;
        }
        if (action === "history" && method === "GET") {
          json(res, await store.versions(id));
          return;
        }
        if (action === "run" && method === "POST") {
          if (engineering.isBusy(id))
            throw new HttpError(409, "工程工具正在运行");
          json(res, await runtime.run(id), 202);
          return;
        }
        if (action === "abort" && method === "POST") {
          await engineering.abort(id);
          await runtime.abort(id);
          json(res, { ok: true });
          return;
        }
        if (action === "messages" && method === "POST") {
          const data = z
            .object({
              text: z.string().trim().min(1).max(16000),
              mode: z.enum(["steer", "followUp"]).default("steer"),
              attachments: z.array(z.string()).max(5).default([]),
            })
            .parse(await body(req));
          await store.update(id, (p) => {
            p.messages.push({
              id: randomUUID(),
              role: "user",
              text: data.text,
              attachments: data.attachments,
              createdAt: new Date().toISOString(),
            });
          });
          if (p.running && data.mode === "steer")
            await runtime.steer(id, data.text, "steer");
          json(res, { ok: true });
          return;
        }
        if (action === "approvals" && method === "POST") {
          const data = z
            .object({
              stage: z.enum(stages),
              revision: z.number().int(),
              inputHash: z.string().length(64),
              decision: z.enum(["approved", "changes_requested"]),
              comment: z.string().max(4000).optional(),
              key: z.string().uuid(),
            })
            .parse(await body(req));
          if (engineering.isBusy(id))
            throw new HttpError(409, "工具运行期间不能确认");
          json(res, await workflow.approve(id, data));
          return;
        }
        if (action === "revisions" && method === "POST") {
          if (engineering.isBusy(id))
            throw new HttpError(409, "请等待工程任务结束");
          const data = z
            .object({
              stage: z.enum(stages),
              revision: z.number().int(),
              comment: z.string().trim().min(1).max(4000),
            })
            .parse(await body(req));
          await workflow.revise(id, data.stage, data.revision, data.comment);
          json(res, { ok: true });
          return;
        }
        if (action === "choice" && method === "POST") {
          const data = z
            .object({
              stage: z.enum(stages),
              revision: z.number().int(),
              choice: z.string(),
            })
            .parse(await body(req));
          await workflow.choose(id, data.stage, data.revision, data.choice);
          json(res, { ok: true });
          return;
        }
        if (action === "choice-answers" && method === "POST") {
          const data = z
            .object({
              stage: z.enum(stages),
              revision: z.number().int(),
              answers: answersSchema,
            })
            .parse(await body(req));
          await workflow.answerChoiceQuestions(
            id,
            data.stage,
            data.revision,
            data.answers,
          );
          json(res, { ok: true });
          return;
        }
        if (action === "answers" && method === "POST") {
          const data = z
            .object({
              interactionId: z.string().uuid(),
              answers: answersSchema,
            })
            .parse(await body(req));
          await runtime.prepareAnswer(id, data.interactionId, data.answers);
          await workflow.answer(id, data.interactionId, data.answers);
          json(res, { ok: true });
          return;
        }
        if (action === "parameters" && method === "PUT") {
          if (p.running || engineering.isBusy(id))
            throw new HttpError(409, "请等待任务结束");
          const parameters = enclosureSchema.parse(await body(req));
          await store.update(id, (p) => {
            p.parameters = parameters;
            invalidate(p, "structure");
          });
          json(res, { ok: true });
          return;
        }
        if (action === "cad" && method === "POST") {
          if (p.running) throw new HttpError(409, "智能体正在运行");
          await body(req);
          json(res, await engineering.cad(id, p.parameters));
          return;
        }
        if (action === "text-parameters" && method === "POST") {
          if (p.running) throw new HttpError(409, "请等待任务结束");
          const data = z
            .object({ instruction: z.string().trim().min(1).max(4000) })
            .parse(await body(req));
          json(res, await runtime.interpretText(id, data.instruction));
          return;
        }
        if (action === "image-parameters" && method === "POST") {
          if (p.running) throw new HttpError(409, "请等待任务结束");
          const data = z
            .object({
              attachmentId: z.string().uuid(),
              referenceWidthMm: z.number().min(20).max(300),
              instruction: z.string().max(4000),
            })
            .parse(await body(req));
          json(
            res,
            await runtime.interpretImage(
              id,
              data.attachmentId,
              data.referenceWidthMm,
              data.instruction,
            ),
          );
          return;
        }
        if (action === "uploads" && method === "POST") {
          if (p.running) throw new HttpError(409, "请等待任务结束");
          const data = z
            .object({
              name: z.string().max(160),
              mime: z.enum([
                "image/png",
                "image/jpeg",
                "image/webp",
                "text/plain",
                "application/pdf",
              ]),
              data: z.string().max(11_000_000),
            })
            .parse(await body(req));
          const bytes = Buffer.from(data.data, "base64");
          if (bytes.length > 8_000_000 || !bytes.length)
            throw new HttpError(400, "文件需小于 8MB");
          if (
            (data.mime === "image/png" &&
              !bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
            (data.mime === "image/jpeg" && bytes[0] !== 255) ||
            (data.mime === "image/webp" &&
              (bytes.toString("ascii", 0, 4) !== "RIFF" ||
                bytes.toString("ascii", 8, 12) !== "WEBP"))
          )
            throw new HttpError(400, "图片格式不匹配");
          const upload = {
            id: randomUUID(),
            name: data.name,
            mime: data.mime,
            path: `uploads/${randomUUID()}`,
            hash: hash(bytes),
          };
          await mkdir(join(store.dir(id), "uploads"), { recursive: true });
          await writeFile(within(store.dir(id), upload.path), bytes);
          let list: any[] = [];
          try {
            list = JSON.parse(
              await readFile(join(store.dir(id), "uploads.json"), "utf8"),
            );
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
          list.push(upload);
          await writeFile(
            join(store.dir(id), "uploads.json"),
            JSON.stringify(list),
          );
          json(res, upload, 201);
          return;
        }
        if (action === "uploads" && method === "GET") {
          try {
            json(
              res,
              JSON.parse(
                await readFile(join(store.dir(id), "uploads.json"), "utf8"),
              ),
            );
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
            json(res, []);
          }
          return;
        }
        if (action.startsWith("artifacts/") && method === "GET") {
          const artifactId = action.slice(10),
            a = Object.values(p.stages)
              .flatMap((s) => s.artifacts)
              .find((a) => a.id === artifactId);
          if (!a) throw new HttpError(404, "产物不存在或已失效");
          await store.verify(id, [a]);
          res.writeHead(200, {
            "Content-Type": a.mime,
            "Content-Disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename="${a.name}"`,
            "Cache-Control": "private, max-age=0",
          });
          res.end(await readFile(within(store.dir(id), a.path)));
          return;
        }
        if (action === "export" && method === "GET") {
          if (p.running || engineering.isBusy(id))
            throw new HttpError(409, "请等待任务结束");
          const files: Record<string, Uint8Array> = {};
          const approved = Object.values(p.stages).filter(
            (s) => s.status === "approved",
          );
          for (const s of approved)
            if (s.draft) {
              await store.verify(id, s.artifacts);
              files[`context/${s.id}.json`] = strToU8(
                JSON.stringify(s.draft, null, 2),
              );
              for (const a of s.artifacts)
                files[
                  `${s.id}/${a.name === "main.cpp" ? "src/main.cpp" : a.name}`
                ] = await readFile(within(store.dir(id), a.path));
            }
          files["README.md"] = strToU8(
            "# " +
              p.name +
              "\n\n" +
              p.brief +
              "\n\n" +
              (approved.length === 8
                ? "全部阶段已确认。"
                : "这是部分阶段交付，尚未完成全部确认。") +
              "\n\n## 重建 CAD\n\n安装 cad/requirements.lock 后，在 cad/ 目录运行：python enclosure.py rebuilt < parameters.json。reference-component-*.stl 为部件参考包络，不应打印。\n\n## 重建固件\n\n安装 PlatformIO 6.1.18 后，在 firmware/ 目录运行 pio run。固件仅经过编译检查，实物烧录和功能仍需用户验证。\n\n## 装配与测试\n\n参考 context/structure.json、context/firmware.json 和 context/delivery.json 中的装配、接线与测试说明。若这些文件不存在，表示相应阶段尚未确认。打印前检查接口、线缆空间和公差；装配时断电，先核对供电与引脚。\n",
          );
          if (approved.some((s) => s.id === "cad"))
            files["cad/requirements.lock"] = await readFile(
              join(root, "workers/cad/requirements.lock"),
            );
          files["manifest.json"] = strToU8(
            JSON.stringify(
              {
                name: p.name,
                brief: p.brief,
                version: p.version,
                complete: approved.length === 8,
                physicalTested: false,
                approvals: p.approvals,
                parts: (await workflow.catalogFor(id)).filter((c) =>
                  p.selectedParts.includes(c.id),
                ),
                parameters: p.parameters,
                artifacts: approved.flatMap((s) => s.artifacts),
              },
              null,
              2,
            ),
          );
          res.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Disposition":
              'attachment; filename="DreamaticMake-project.zip"',
          });
          const archive = zipSync(files);
          await mkdir(join(store.dir(id), "exports"), { recursive: true });
          await writeFile(
            join(
              store.dir(id),
              "exports",
              `project-v${p.version}-${Date.now()}.zip`,
            ),
            archive,
          );
          res.end(archive);
          return;
        }
        throw new HttpError(404, "接口不存在");
      }
      if (path.startsWith("/api/")) throw new HttpError(404, "接口不存在");
      if (method !== "GET") throw new HttpError(405, "不支持此方法");
      const base = join(root, "dist/web");
      let file = within(base, path.replace(/^\//, ""));
      try {
        if (!(await stat(file)).isFile()) file = join(base, "index.html");
      } catch {
        file = join(base, "index.html");
      }
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      });
      res.end(await readFile(file));
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status =
        e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500;
      json(res, { error: e instanceof Error ? e.message : "服务异常" }, status);
    }
  });
  return {
    server,
    store,
    workflow,
    runtime,
    engineering,
    designEngine,
    settings,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createApp();
  app.server.listen(4320, "127.0.0.1", () =>
    console.log("DreamaticMake http://127.0.0.1:4320"),
  );
  let stopping = false;
  for (const event of ["SIGINT", "SIGTERM"])
    process.on(event, async () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 5000);
      for (const project of await app.store.list()) {
        app.designEngine.abort(project.id);
        await app.engineering.abort(project.id);
        await app.runtime.abort(project.id);
      }
      app.server.closeAllConnections();
      app.server.close(() => {
        clearTimeout(deadline);
        process.exit(0);
      });
    });
}
