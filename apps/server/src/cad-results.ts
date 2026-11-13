import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, realpath, type FileHandle } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { hasCadResults, type CadResultFile } from "../../../packages/core/src/cad-results";
import type { StageRecord } from "../../../packages/core/src/project";
import type { ProjectStore } from "../../../packages/core/src/store";

const route = /^\/api\/projects\/([0-9a-f-]{36})\/cad\/([a-z_]+)(?:\/([0-9a-f]{64}))?$/;
const maxPreviewBytes = 64 * 1024 * 1024;
const mediaTypes = { stl: "model/stl", step: "model/step", "3dm": "application/vnd.rhino" };

function cadFormat(path: string): CadResultFile["format"] | undefined {
  const extension = extname(path).toLowerCase();
  if (extension === ".step" || extension === ".stp") return "step";
  if (extension === ".stl") return "stl";
  if (extension === ".3dm") return "3dm";
}

function cadReferences(deliverable: unknown) {
  const references = new Map<string, string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    const { relative_path: path, sha256 } = value as Record<string, unknown>;
    if (typeof path === "string" && /^(workspace|doc)\/(?!\.)/.test(path) &&
        path.split("/").every((part) => part && !part.startsWith(".") && !part.includes("\\")) &&
        cadFormat(path) && typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256)) {
      references.set(path, sha256);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(deliverable);
  return references;
}

async function stlReady(file: FileHandle, size: number) {
  if (size < 15) return false;
  const header = Buffer.alloc(Math.min(size, 84));
  await file.read(header, 0, header.length, 0);
  if (header.length === 84) {
    const faces = header.readUInt32LE(80);
    if (faces > 0 && size === 84 + faces * 50) return true;
  }
  if (!/^solid\b/.test(header.toString("ascii").trimStart())) return false;
  const tail = Buffer.alloc(Math.min(size, 1024));
  await file.read(tail, 0, tail.length, size - tail.length);
  return /(?:^|\n)\s*endsolid[^\n]*\s*$/.test(tail.toString("ascii"));
}

async function* openCadFiles(projectRoot: string, stage: StageRecord) {
  const references = cadReferences(stage.artifact?.structured?.deliverable);
  const paths = new Set(references.keys());
  const pinnedFormats = new Set([...paths].map(cadFormat));
  for (const folder of [`workspace/${stage.id}`, `doc/${stage.id}`]) {
    const directory = join(projectRoot, folder);
    if (await realpath(directory).catch(() => undefined) !== directory) continue;
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const format = cadFormat(entry.name);
      if (entry.isFile() && !entry.name.startsWith(".") && format && !pinnedFormats.has(format)) {
        paths.add(`${folder}/${entry.name}`);
      }
    }
  }
  for (const path of paths) {
    const absolute = join(projectRoot, path);
    if (await realpath(absolute).catch(() => undefined) !== absolute) continue;
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined);
    if (!file) continue;
    try {
      const info = await file.stat();
      const format = cadFormat(path)!;
      if (!info.isFile() || !info.size || (format === "stl" && !await stlReady(file, info.size))) continue;
      const expectedHash = references.get(path);
      const id = createHash("sha256").update(JSON.stringify([path, info.ino, info.size, info.mtimeMs, expectedHash])).digest("hex");
      yield { asset: { id, filename: basename(path), format, previewable: format === "stl" && info.size <= maxPreviewBytes } satisfies CadResultFile,
        file, size: info.size, modified: info.mtimeMs, expectedHash };
    } finally {
      await file.close();
    }
  }
}

export async function serveCadResults(store: ProjectStore, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = req.method === "GET" && route.exec(url.pathname);
  if (!match) return false;
  const [, projectId, stageId, assetId] = match;
  const root = await realpath(store.root).catch(() => undefined);
  const projectRoot = root && join(root, projectId);
  if (!hasCadResults(stageId) || !projectRoot || await realpath(projectRoot).catch(() => undefined) !== projectRoot) {
    res.writeHead(404).end();
    return true;
  }
  const project = await store.get(projectId).catch(() => undefined);
  const stage = project?.stages.find(({ id }) => id === stageId);
  if (!stage || project?.importedRun) {
    res.writeHead(404).end();
    return true;
  }
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  const files: { asset: CadResultFile; modified: number }[] = [];
  for await (const { asset, file, size, modified, expectedHash } of openCadFiles(projectRoot, stage)) {
    if (!assetId) files.push({ asset, modified });
    if (asset.id !== assetId) continue;
    if (expectedHash) {
      const digest = createHash("sha256");
      for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) digest.update(chunk);
      if (digest.digest("hex") !== expectedHash) {
        res.writeHead(409, headers).end();
        return true;
      }
    }
    const current = await file.stat();
    if (current.size !== size || current.mtimeMs !== modified) {
      res.writeHead(409, headers).end();
      return true;
    }
    res.writeHead(200, {
      ...headers,
      "Content-Type": mediaTypes[asset.format],
      "Content-Length": size,
      "Content-Disposition": `${asset.format === "stl" && !url.searchParams.has("download") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    });
    await pipeline(file.createReadStream({ start: 0, autoClose: false }), res).catch(() => res.destroy());
    return true;
  }
  if (assetId) res.writeHead(404, headers).end();
  else {
    files.sort((a, b) => b.modified - a.modified || a.asset.filename.localeCompare(b.asset.filename));
    res.writeHead(200, { ...headers, "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify(files.map(({ asset }) => asset)));
  }
  return true;
}
