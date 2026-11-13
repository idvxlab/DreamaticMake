import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, sep } from "node:path";

const route = /^\/api\/projects\/([0-9a-f-]{36})\/appearance-previews(?:\/([0-9a-f]{64}))?$/;
const outputFolders = ["doc/appearance", "workspace/appearance"];
const maxImageSize = 32 * 1024 * 1024;

function imageType(name: string) {
  switch (extname(name).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
  }
}

function imageReady(data: Buffer, type: string) {
  if (data.length < 20) return false;
  if (type === "image/png") return data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    && data.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"));
  if (type === "image/jpeg") return data.readUInt16BE(0) === 0xffd8 && data.readUInt16BE(data.length - 2) === 0xffd9;
  return data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" && data.readUInt32LE(4) + 8 === data.length;
}

async function* appearanceImages(root: string) {
  for (const folder of outputFolders) {
    const directory = await realpath(join(root, folder)).catch(() => undefined);
    if (!directory?.startsWith(`${root}${sep}`)) continue;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const type = imageType(entry.name);
      if (!type) continue;
      const file = await open(join(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined);
      if (!file) continue;
      let result;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > maxImageSize) continue;
        const data = await file.readFile();
        if (data.length === info.size && imageReady(data, type)) {
          result = { id: createHash("sha256").update(data).digest("hex"), filename: entry.name, updatedAt: info.mtimeMs, type, data };
        }
      } catch {
        // The agent can replace a file between directory enumeration and read.
      } finally { await file.close(); }
      if (result) yield result;
    }
  }
}

export async function serveAppearancePreview(workspace: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const match = req.method === "GET" && route.exec((req.url ?? "").split("?", 1)[0]);
  if (!match) return false;
  const [, projectId, assetId] = match;
  const root = await realpath(workspace).catch(() => undefined);
  const projectRoot = root && await realpath(join(root, projectId)).catch(() => undefined);
  if (projectRoot !== (root && join(root, projectId)) || !projectRoot || !(await stat(join(projectRoot, "project-state.json")).catch(() => undefined))?.isFile()) {
    res.writeHead(404).end();
    return true;
  }
  const previews = new Map<string, { id: string; filename: string; updatedAt: number }>();
  for await (const { id, filename, updatedAt, type, data } of appearanceImages(projectRoot)) {
    if (assetId === id) {
      res.writeHead(200, {
        "Content-Type": type, "Content-Length": data.length, "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
      }).end(data);
      return true;
    }
    if (!assetId && !previews.has(id)) previews.set(id, { id, filename, updatedAt });
  }
  if (assetId) res.writeHead(404).end();
  else res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
    .end(JSON.stringify([...previews.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.filename.localeCompare(b.filename))));
  return true;
}
