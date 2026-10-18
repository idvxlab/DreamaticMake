import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  appendFile,
  rm,
} from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import {
  stages,
  defaultEnclosure,
  enclosureSchema,
  type Project,
  type Event,
  type Artifact,
  type StageId,
  type Part,
} from "./contracts";
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? (value as string)
        : JSON.stringify(value),
    )
    .digest("hex");
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function validId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new HttpError(400, "无效标识");
  return id;
}
export function within(root: string, path: string) {
  const p = resolve(root, path),
    r = relative(resolve(root), p);
  if (r.startsWith("..") || isAbsolute(r)) throw new HttpError(400, "路径越界");
  return p;
}
export class Store {
  readonly events = new EventEmitter();
  private queues = new Map<string, Promise<unknown>>();
  private catalogQueues = new Map<string, Promise<unknown>>();
  private eventQueues = new Map<string, Promise<unknown>>();
  private sequences = new Map<string, number>();
  constructor(
    readonly root: string,
    readonly defaultCatalog: Part[] = [],
  ) {}
  dir(id: string) {
    const name = validId(id),
      direct = join(this.root, name),
      legacy = join(this.root, "projects", name);
    return !existsSync(join(direct, "project.json")) &&
      existsSync(join(legacy, "project.json"))
      ? legacy
      : direct;
  }
  async create(name: string, brief: string) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const p: Project = {
      id,
      name,
      brief,
      createdAt: now,
      updatedAt: now,
      version: 1,
      archived: false,
      stages: Object.fromEntries(
        stages.map((id) => [
          id,
          { id, status: "not_started", revision: 1, artifacts: [] },
        ]),
      ) as unknown as Project["stages"],
      messages: [
        { id: randomUUID(), role: "user", text: brief, createdAt: now },
      ],
      approvals: [],
      parameters: { ...defaultEnclosure },
      selectedParts: [],
      running: false,
    };
    await mkdir(this.dir(id), { recursive: true });
    await this.save(p);
    await this.ensureProject(id);
    return p;
  }
  async get(id: string): Promise<Project> {
    try {
      const p = JSON.parse(
        await readFile(join(this.dir(id), "project.json"), "utf8"),
      );
      p.parameters = enclosureSchema.parse(p.parameters);
      return p;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new HttpError(404, "项目不存在");
      throw e;
    }
  }
  async ensureProject(id: string) {
    for (const name of [
      "context",
      "hardware",
      "sources",
      "uploads",
      "sessions",
      "jobs",
      "artifacts",
      "reports",
      "exports",
      "history",
    ])
      await mkdir(join(this.dir(id), name), { recursive: true });
    if (
      this.defaultCatalog.length &&
      !existsSync(join(this.dir(id), "hardware/catalog.json"))
    )
      await this.saveCatalog(id, this.defaultCatalog);
  }
  async projectCatalog(
    id: string,
    fallback: Part[] = this.defaultCatalog,
  ): Promise<Part[]> {
    await this.get(id);
    try {
      return JSON.parse(
        await readFile(join(this.dir(id), "hardware/catalog.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return structuredClone(fallback);
      throw e;
    }
  }
  async addCatalogPart(
    id: string,
    part: Part,
    fallback: Part[] = this.defaultCatalog,
  ) {
    const previous = this.catalogQueues.get(id) ?? Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(async () => {
        const catalog = await this.projectCatalog(id, fallback);
        if (catalog.some((item) => item.id === part.id))
          throw new HttpError(409, "候选 ID 已存在");
        catalog.push(part);
        await this.saveCatalog(id, catalog);
      });
    this.catalogQueues.set(id, pending);
    try {
      await pending;
    } finally {
      if (this.catalogQueues.get(id) === pending) this.catalogQueues.delete(id);
    }
  }
  async saveCatalog(id: string, parts: Part[]) {
    await mkdir(join(this.dir(id), "hardware"), { recursive: true });
    const tmp = join(this.dir(id), "hardware", randomUUID() + ".tmp");
    await writeFile(tmp, JSON.stringify(parts, null, 2));
    await rename(tmp, join(this.dir(id), "hardware/catalog.json"));
  }
  async initialize() {
    await mkdir(this.root, { recursive: true });
    const legacy = join(this.root, "projects");
    if (existsSync(legacy)) {
      for (const id of await readdir(legacy)) {
        if (
          !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
          !existsSync(join(legacy, id, "project.json"))
        )
          continue;
        const destination = join(this.root, id);
        if (existsSync(destination))
          throw new HttpError(
            409,
            "项目目录迁移发生冲突：" + id + "，原文件已保留",
          );
        await rename(join(legacy, id), destination);
      }
    }
    for (const p of await this.list()) await this.ensureProject(p.id);
  }
  async list() {
    await mkdir(this.root, { recursive: true });
    const ids = new Set<string>();
    for (const folder of [this.root, join(this.root, "projects")]) {
      let names: string[];
      try {
        names = await readdir(folder);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
      for (const id of names)
        if (
          /^[a-zA-Z0-9_-]{1,80}$/.test(id) &&
          existsSync(join(folder, id, "project.json"))
        )
          ids.add(id);
    }
    const out = await Promise.all([...ids].map((id) => this.get(id)));
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async save(p: Project) {
    const tmp = join(this.dir(p.id), `${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(p, null, 2));
    await rename(tmp, join(this.dir(p.id), "project.json"));
    await mkdir(join(this.dir(p.id), "context"), { recursive: true });
    for (const stage of Object.values(p.stages))
      if (stage.draft) {
        const file = join(this.dir(p.id), "context", stage.id + ".json"),
          draftTmp = file + "." + randomUUID() + ".tmp";
        await writeFile(
          draftTmp,
          JSON.stringify(
            {
              revision: stage.revision,
              status: stage.status,
              draft: stage.draft,
              review: stage.review,
            },
            null,
            2,
          ),
        );
        await rename(draftTmp, file);
      }
  }
  async update<T>(id: string, fn: (p: Project) => T | Promise<T>): Promise<T> {
    const old = this.queues.get(id) ?? Promise.resolve();
    const next = old
      .catch(() => {})
      .then(async () => {
        const p = await this.get(id);
        const previous = JSON.stringify(p, null, 2);
        const result = await fn(p);
        await mkdir(join(this.dir(id), "history"), { recursive: true });
        const snapshot = join(this.dir(id), "history", `${randomUUID()}.tmp`);
        await writeFile(snapshot, previous);
        await rename(
          snapshot,
          join(this.dir(id), "history", String(p.version) + ".json"),
        );
        p.version++;
        p.updatedAt = new Date().toISOString();
        await this.save(p);
        await this.emit(id, "project.updated", { version: p.version });
        return result;
      });
    this.queues.set(id, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(id) === next) this.queues.delete(id);
    }
  }
  async delete(id: string, expectedName: string) {
    const old = this.queues.get(id) ?? Promise.resolve();
    const pending = old
      .catch(() => {})
      .then(async () => {
        const p = await this.get(id);
        if (p.running) throw new HttpError(409, "请先停止项目任务");
        if (p.name !== expectedName)
          throw new HttpError(409, "项目名称已变化，请重新确认删除");
        await this.eventQueues.get(id)?.catch(() => {});
        await rm(this.dir(id), { recursive: true, force: false });
        this.sequences.delete(id);
        this.events.emit(id, {
          id: randomUUID(),
          sequence: 0,
          projectId: id,
          type: "project.deleted",
          timestamp: new Date().toISOString(),
          payload: {},
        });
        this.events.removeAllListeners(id);
      });
    this.queues.set(id, pending);
    try {
      await pending;
    } finally {
      if (this.queues.get(id) === pending) this.queues.delete(id);
    }
  }
  async emit(id: string, type: string, payload: unknown) {
    const previous = this.eventQueues.get(id) ?? Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(async () => {
        let sequence = this.sequences.get(id);
        if (sequence === undefined)
          sequence = (await this.history(id)).at(-1)?.sequence ?? 0;
        const event: Event = {
          id: randomUUID(),
          sequence: sequence + 1,
          projectId: id,
          type,
          timestamp: new Date().toISOString(),
          payload,
        };
        await appendFile(
          join(this.dir(id), "events.jsonl"),
          JSON.stringify(event) + "\n",
        );
        this.sequences.set(id, event.sequence);
        this.events.emit(id, event);
        return event;
      });
    this.eventQueues.set(id, pending);
    try {
      return await pending;
    } finally {
      if (this.eventQueues.get(id) === pending) this.eventQueues.delete(id);
    }
  }
  async history(id: string) {
    try {
      return (await readFile(join(this.dir(id), "events.jsonl"), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s) as Event);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async artifact(
    id: string,
    stage: StageId,
    revision: number,
    name: string,
    data: Buffer | string,
    mime: string,
  ): Promise<Artifact> {
    const artifactId = randomUUID(),
      path = `artifacts/${artifactId}/${name}`;
    const full = within(this.dir(id), path);
    await mkdir(resolve(full, ".."), { recursive: true });
    await writeFile(full, data);
    const bytes = Buffer.from(data);
    return {
      id: artifactId,
      name,
      path,
      mime,
      hash: hash(bytes),
      size: bytes.length,
      stage,
      revision,
    };
  }
  async versions(id: string) {
    const folder = join(this.dir(id), "history");
    try {
      const files = await readdir(folder);
      const items = [];
      for (const f of files.filter((f) => /^\d+\.json$/.test(f))) {
        const p: Project = JSON.parse(await readFile(join(folder, f), "utf8"));
        items.push({
          version: p.version,
          updatedAt: p.updatedAt,
          stages: Object.values(p.stages).map((s) => ({
            id: s.id,
            status: s.status,
            revision: s.revision,
            title: s.draft?.title,
          })),
          messageCount: p.messages.length,
        });
      }
      return items.sort((a, b) => b.version - a.version);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async verify(id: string, artifacts: Artifact[]) {
    for (const a of artifacts) {
      const bytes = await readFile(within(this.dir(id), a.path));
      if (hash(bytes) !== a.hash)
        throw new HttpError(409, `产物已变更：${a.name}`);
    }
  }
  async recover() {
    for (const p of await this.list()) {
      const eventFile = join(this.dir(p.id), "events.jsonl");
      try {
        const log = await readFile(eventFile, "utf8");
        if (log && !log.endsWith("\n"))
          await writeFile(eventFile, log.slice(0, log.lastIndexOf("\n") + 1));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (p.running)
        await this.update(p.id, (p) => {
          p.running = false;
          for (const s of Object.values(p.stages))
            if (s.status === "running") {
              s.status = "failed";
              s.error = "服务重启，任务已中断。可重新执行。";
            }
        });
    }
  }
}
