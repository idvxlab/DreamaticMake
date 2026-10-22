import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { HttpError } from "../../../packages/core/src/store";
import { notebookSchema } from "../../../packages/core/src/design-workspace";

const slug = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const metadata = z
  .object({
    version: z.literal(1),
    id: slug,
    title: z.string().min(1).max(100),
    summary: z.string().max(1000),
    focus: z.array(z.string().max(30)).max(5),
  })
  .strict();

/** Read-only local examples. Case data is intentionally outside version control. */
export class DesignCases {
  constructor(readonly directory: string) {}
  private async read(id: string, path: string, limit = 500_000) {
    const root = await realpath(this.directory);
    const file = await realpath(join(root, slug.parse(id), path));
    const part = relative(join(root, id), file);
    if (isAbsolute(part) || part.startsWith(".."))
      throw new HttpError(400, "案例文件越出目录");
    if ((await stat(file)).size > limit)
      throw new HttpError(413, "案例文件过大");
    return readFile(file, "utf8");
  }
  async list() {
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const result = [];
    for (const entry of entries
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (!slug.safeParse(entry.name).success) continue;
      try {
        const item = metadata.parse(
          JSON.parse(await this.read(entry.name, "project.json")),
        );
        if (item.id !== entry.name)
          throw new HttpError(400, "案例 ID 与目录不匹配");
        result.push(item);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new HttpError(422, `案例 ${entry.name} 的 project.json 无效`);
      }
    }
    return result;
  }
  async load(id: string) {
    slug.parse(id);
    const item = (await this.list()).find((c) => c.id === id);
    if (!item) throw new HttpError(404, "设计案例不存在");
    const files = (await readdir(join(this.directory, id, "components")))
      .filter((f) => /^[A-Za-z_][A-Za-z0-9_.-]*\.json$/.test(f))
      .sort();
    if (!files.length || files.length > 64)
      throw new HttpError(422, "案例需要 1–64 个元件定义");
    const components: Record<string, unknown> = {};
    for (const file of files)
      components[file.slice(0, -5)] = JSON.parse(
        await this.read(id, `components/${file}`),
      );
    const source: Record<string, unknown> = {
      record_kind: "layout_project",
      project_version: 1,
      components,
    };
    for (const [key, file] of Object.entries({
      structure: "structure",
      motion: "motion",
      circuit_energy: "circuit-energy",
      flow: "flow",
    }))
      source[key] = JSON.parse(await this.read(id, `design/${file}.json`));
    const config = JSON.parse(await this.read(id, "logic/notebook.json"));
    const cells = z
      .array(
        z
          .object({
            id: slug,
            file: z.string().regex(/^[a-z][a-z0-9_-]*\.py$/),
          })
          .strict(),
      )
      .max(16)
      .parse(config.cells);
    const notebook = notebookSchema.parse({
      ...config,
      cells: await Promise.all(
        cells.map(async (cell) => ({
          id: cell.id,
          code: await this.read(id, `logic/${cell.file}`, 20000),
        })),
      ),
    });
    return { metadata: item, source, notebook };
  }
}
