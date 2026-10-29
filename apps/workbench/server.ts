import {
  assemblyStore,
  type AssemblyStore,
} from "../../packages/workbench/assembly";
import { createServer, type IncomingMessage } from "node:http";
import { createReadStream } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { Workbench } from "../../packages/workbench/runtime";
import {
  hardwareLibrary,
  HardwareLibrary,
} from "../../packages/workbench/hardware";
import {
  hardwareLookupSchema,
  hardwareRefSchema,
  hardwareSources,
} from "../../packages/workbench/hardware-contracts";
import {
  WorkbenchAuth,
  SESSION_SECONDS,
  RENEW_WINDOW_MS,
} from "../../packages/workbench/auth";

import {
  connectionStore,
  ConnectionStore,
} from "../../packages/workbench/connection";
import { imageStore, ImageStore } from "../../packages/workbench/images";

import {
  appearanceStore,
  AppearanceStore,
} from "../../packages/workbench/appearance";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw new Error("请求超过64KB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function makeServer(
  workbench: Workbench,
  token?: string,
  connections: ConnectionStore = connectionStore,
  auth = new WorkbenchAuth(token),
  library: HardwareLibrary = hardwareLibrary,
  images: ImageStore = imageStore,
  appearances: AppearanceStore = appearanceStore,
  assemblies: AssemblyStore = assemblyStore,
) {
  let loggingIn = 0;
  const server = createServer(async (req, res) => {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    const setSession = () =>
      res.setHeader(
        "Set-Cookie",
        `dreamatic_workbench=${auth.createSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`,
      );
    try {
      // Bind loopback only; reject untrusted Host/Origin to prevent DNS rebinding and cross-site writes.
      const host = req.headers.host || "";
      if (!/^127\.0\.0\.1:\d+$/.test(host)) {
        json(403, { error: "非法 Host" });
        return;
      }
      if (req.headers.origin && req.headers.origin !== `http://${host}`) {
        json(403, { error: "跨站请求被拒绝" });
        return;
      }
      const url = new URL(req.url || "/", `http://${host}`);
      const path = url.pathname;
      if (path.startsWith("/workbench-api/")) {
        if (
          req.method === "POST" &&
          (req.headers["x-workbench"] !== "1" ||
            !req.headers["content-type"]?.startsWith("application/json"))
        ) {
          json(403, { error: "需要应用 JSON 请求" });
          return;
        }
        if (path === "/workbench-api/session" && req.method === "POST") {
          const value = z
            .object({ token: z.string().max(256) })
            .parse(await body(req));
          if (!equal(value.token, auth.token)) {
            loggingIn++;
            json(loggingIn > 20 ? 429 : 401, {
              error: "访问令牌无效，请从运行服务的终端复制",
            });
            return;
          }
          loggingIn = 0;
          setSession();
          json(200, { ok: true });
          return;
        }
        const cookie = req.headers.cookie
          ?.split(";")
          .map((c) => c.trim())
          .find((c) => c.startsWith("dreamatic_workbench="))
          ?.slice("dreamatic_workbench=".length);
        const expires = cookie ? auth.expiresAt(cookie) : undefined;
        if (!expires) {
          json(401, { error: "请使用终端显示的带令牌链接连接本地工作台" });
          return;
        }
        if (expires - Date.now() < RENEW_WINDOW_MS) setSession();
        if (
          path.startsWith("/workbench-api/assembly/") &&
          req.method === "GET"
        ) {
          const match =
            /^\/workbench-api\/assembly\/([a-f0-9-]+)\/([a-zA-Z0-9_.-]+)$/.exec(
              path,
            );
          if (!match) throw new Error("装配资产路径无效");
          const { asset, bytes } = await assemblies.asset(
            match[1],
            match[2],
            z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .parse(url.searchParams.get("revision")),
            z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .parse(url.searchParams.get("sha256")),
          );
          res.writeHead(200, {
            "Content-Type": asset.id.endsWith(".stl")
              ? "model/stl"
              : asset.id.endsWith(".json")
                ? "application/json"
                : "application/octet-stream",
            "Content-Length": bytes.length,
            "Cache-Control": "private, max-age=86400",
            ETag: `"${asset.sha256}"`,
            "Content-Disposition": `attachment; filename="${asset.id}"`,
          });
          res.end(bytes);
          return;
        }
        if (
          path.startsWith("/workbench-api/appearance/") &&
          req.method === "GET"
        ) {
          const match =
            /^\/workbench-api\/appearance\/([a-f0-9-]+)\/([a-zA-Z0-9_.-]+)$/.exec(
              path,
            );
          if (!match) throw new Error("外形资产路径无效");
          const revision = z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .parse(url.searchParams.get("revision"));
          const sha = z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .parse(url.searchParams.get("sha256"));
          const { asset, bytes } = await appearances.asset(
            match[1],
            match[2],
            revision,
            sha,
          );
          res.writeHead(200, {
            "Content-Type": asset.id.endsWith(".stl")
              ? "model/stl"
              : asset.id.endsWith(".json")
                ? "application/json"
                : "application/octet-stream",
            "Content-Length": bytes.length,
            "Cache-Control": "private, max-age=86400",
            ETag: `"${asset.sha256}"`,
            ...(asset.id.endsWith(".step")
              ? { "Content-Disposition": `attachment; filename="${asset.id}"` }
              : {}),
          });
          res.end(bytes);
          return;
        }
        if (path.startsWith("/workbench-api/images/") && req.method === "GET") {
          const id = z
            .string()
            .uuid()
            .parse(path.slice("/workbench-api/images/".length));
          const { asset, bytes } = await images.read(id);
          res.writeHead(200, {
            "Content-Type": asset.mime,
            "Content-Length": bytes.length,
            "Cache-Control": "private, max-age=86400",
            ETag: `"${asset.sha256}"`,
          });
          res.end(bytes);
          return;
        }
        if (
          path.startsWith("/workbench-api/library/") &&
          req.method === "GET"
        ) {
          const query = Object.fromEntries(url.searchParams);
          if (path === "/workbench-api/library/status") {
            json(200, await library.status());
            return;
          }
          if (path === "/workbench-api/library/search") {
            const input = z
              .object({
                query: z.string().max(120).default(""),
                source: z.enum(hardwareSources).optional(),
                limit: z.coerce.number().int().min(1).max(30).default(15),
                offset: z.coerce.number().int().min(0).max(100000).default(0),
              })
              .parse(query);
            json(
              200,
              await library.search(
                input.query,
                input.source,
                input.limit,
                input.offset,
              ),
            );
            return;
          }
          const input = hardwareLookupSchema.parse(query);
          if (path === "/workbench-api/library/record") {
            json(200, await library.get(input.source, input.recordId));
            return;
          }
          if (path === "/workbench-api/library/document") {
            const { documentId, offset } = z
              .object({
                documentId: z.string().min(1).max(160),
                offset: z.coerce.number().int().min(0).max(10000000).default(0),
              })
              .parse(query);
            json(
              200,
              await library.document(
                input.source,
                input.recordId,
                documentId,
                offset,
              ),
            );
            return;
          }
          if (
            [
              "/workbench-api/library/asset",
              "/workbench-api/library/mesh",
            ].includes(path)
          ) {
            const { assetId, sha256 } = z
              .object({
                assetId: z.string().min(1).max(160),
                sha256: z
                  .string()
                  .regex(/^[a-f0-9]{64}$/)
                  .optional(),
              })
              .parse(query);
            const mesh = path.endsWith("/mesh");
            const asset = await (mesh
              ? library.mesh(input.source, input.recordId, assetId)
              : library.asset(input.source, input.recordId, assetId));
            if (sha256 && asset.sha256 !== sha256) {
              json(409, {
                error: "资产版本已变化，不能用新文件替代旧项目的几何",
              });
              return;
            }
            const info = await stat(asset.file);
            res.writeHead(200, {
              "Content-Type": mesh ? "model/stl" : "application/octet-stream",
              "Content-Length": info.size,
              "Cache-Control": "no-store",
              ...(mesh
                ? {}
                : {
                    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
                  }),
            });
            createReadStream(asset.file)
              .on("error", () => res.destroy())
              .pipe(res);
            return;
          }
          json(404, { error: "硬件库路由不存在" });
          return;
        }
        if (
          path === "/workbench-api/library/inspect" &&
          req.method === "POST"
        ) {
          const input = hardwareLookupSchema
            .extend({ assetId: z.string().min(1).max(160) })
            .parse(await body(req));
          json(
            200,
            await library.inspect(input.source, input.recordId, input.assetId),
          );
          return;
        }
        if (path === "/workbench-api/connection" && req.method === "GET") {
          json(200, await connections.public());
          return;
        }
        if (path === "/workbench-api/project" && req.method === "GET") {
          json(200, {
            project: workbench.project || null,
            busy: workbench.busy,
          });
          return;
        }
        if (req.method !== "POST") {
          json(405, { error: "不支持的方法" });
          return;
        }
        if (workbench.busy && path !== "/workbench-api/request") {
          json(409, { error: "已有专家调用正在运行" });
          return;
        }
        const payload = await body(req);
        if (path === "/workbench-api/library/refresh") {
          json(200, await library.refresh());
          return;
        }
        if (path === "/workbench-api/library/attach") {
          const input = hardwareRefSchema
            .extend({ assetId: z.string().max(160).optional() })
            .parse(payload);
          const record = await library.get(input.source, input.recordId);
          if (record.revision !== input.revision) {
            json(409, { error: "源记录版本已变化，请刷新详情后重新引用" });
            return;
          }
          const geometry = input.assetId
            ? await library.inspect(input.source, input.recordId, input.assetId)
            : undefined;
          await workbench.attachHardware(record, geometry);
          json(200, { ok: true });
          return;
        }
        if (path === "/workbench-api/connection/models") {
          json(200, await connections.catalog(payload));
          return;
        }
        if (path === "/workbench-api/connection") {
          json(200, await connections.save(payload));
          return;
        }
        let job: Promise<void>;
        if (path === "/workbench-api/start") {
          const { brief } = z
            .object({ brief: z.string().trim().min(1).max(6000) })
            .parse(payload);
          job = workbench.start(brief);
        } else if (path === "/workbench-api/answers") {
          const { answers } = z
            .object({ answers: z.record(z.string(), z.string().max(2000)) })
            .parse(payload);
          if (workbench.project?.phase !== "choices") {
            json(409, { error: "当前不在需求确认阶段" });
            return;
          }
          const { validateAnswers } = await import(
            "../../packages/workbench/contracts"
          );
          if (!validateAnswers(workbench.project.questions, answers)) {
            json(400, { error: "请完成所有有效选项" });
            return;
          }
          job = workbench.answer(answers);
        } else if (path === "/workbench-api/continue-with-gaps") {
          const input = z
            .object({
              projectId: z.string().uuid(),
              reason: z.string().min(1).max(10000),
            })
            .parse(payload);
          if (
            workbench.project?.id !== input.projectId ||
            workbench.project.phase !== "blocked" ||
            workbench.project.error !== input.reason
          ) {
            json(409, { error: "项目或缺口已变化，请重新查看后确认" });
            return;
          }
          job = workbench.continueWithGaps(input.projectId, input.reason);
        } else if (path === "/workbench-api/request") {
          const { instruction, inputs } = z
            .object({
              instruction: z.string().trim().min(1).max(6000),
              inputs: z.array(z.string()).max(80),
            })
            .parse(payload);
          job = workbench.request(instruction, inputs);
        } else {
          json(404, { error: "路由不存在" });
          return;
        }
        void job.catch((e) =>
          console.error(
            "Workbench call failed:",
            e instanceof Error ? e.message : "unknown",
          ),
        );
        json(202, { accepted: true });
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end();
        return;
      }
      const root = resolve("dist/web");
      const relative =
        path === "/" || path === "/workbench" || path === "/workbench/"
          ? "workbench/index.html"
          : decodeURIComponent(path).replace(/^\//, "");
      const file = resolve(root, relative);
      if (
        !file.startsWith(root + sep) ||
        (!relative.startsWith("assets/") && relative !== "workbench/index.html")
      ) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      try {
        if (!(await stat(file)).isFile()) throw new Error("not a file");
        res.writeHead(200, {
          "Content-Type": mime[extname(file)] || "application/octet-stream",
        });
        res.end(req.method === "HEAD" ? undefined : await readFile(file));
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("请先执行 npm run build");
      }
    } catch (e) {
      json(400, {
        error:
          e instanceof z.ZodError
            ? "请求格式无效，请检查输入字段"
            : e instanceof Error
              ? e.message
              : "请求无效",
      });
    }
  });
  return { server, token: auth.token };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const workbench = new Workbench();
  await workbench.restore();
  const auth = await WorkbenchAuth.load(resolve("workspace/workbench"));
  await hardwareLibrary.initialize();
  const { server, token } = makeServer(
    workbench,
    undefined,
    connectionStore,
    auth,
  );
  const port = Number(process.env.WORKBENCH_PORT || 4322);
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Dreamatic Workbench\nhttp://127.0.0.1:${port}/workbench/#token=${token}\n模型认证由 Pi SDK 管理；硬件检索与STEP检查已接入，生图由模型设置启用。统一外形CAD与同源三视图已接通；整机制造设计、编译与制造尚未完成。`,
    ),
  );
}
