import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, sep, extname, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { curatedRecords } from "./curated-hardware";
import { relaxedSearchTerms } from "./search-terms";
import {
  HARDWARE_VERSION,
  hardwareSources,
  hardwareSourceNames,
  type HardwareSource,
  type HardwareRecord,
  type HardwareHit,
  type HardwareAsset,
  type HardwareStatus,
  type HardwareGeometry,
} from "./hardware-contracts";

const run = promisify(execFile);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const parse = (text: unknown, fallback: any = {}) => {
  try {
    return JSON.parse(String(text));
  } catch {
    return fallback;
  }
};
const text = (value: unknown, length = 12000) =>
  typeof value === "string" ? value.slice(0, length) : "";
const safeUrl = (value: unknown) =>
  typeof value === "string" && /^https?:\/\//.test(value) ? value : undefined;
const definitions: Record<Exclude<HardwareSource, "curated">, string> = {
  arduino: "official_catalog/library/hardware.sqlite3",
  raspberrypi: "official_catalog/library/raspberrypi.sqlite3",
  misumi: "official_catalog/library/misumi.sqlite3",
  references: "official_catalog/library/reference-parts.sqlite3",
  amazon: "jd_purchase/runs/amazon_batch/purchase.sqlite3",
  seed: "components.sqlite3",
  requirements: "parts_library/data/parts_library.sqlite3",
};
type Row = Record<string, any>;

/** Read-only adapters over the user's source databases. Only the compact search cache is written. */
export class HardwareLibrary {
  private index?: DatabaseSync;
  private initializing?: Promise<void>;
  private statusValue?: HardwareStatus;
  private inspecting = new Map<string, Promise<HardwareGeometry>>();
  private curated = new Map<string, HardwareRecord>();
  constructor(
    readonly root = resolve(
      process.env.WORKBENCH_LIBRARY_ROOT || "../CAD生成相关/小家电元件库",
    ),
    readonly cache = resolve("workspace/workbench/library"),
    readonly python = resolve(
      process.env.WORKBENCH_GEOMETRY_PYTHON ||
        "../CAD生成相关/DreamaticMake/.venv/bin/python",
    ),
  ) {}
  private database(source: HardwareSource) {
    if (source === "curated")
      throw new Error("补充资料没有 SQLite 文件或本地 CAD 资产");
    return new DatabaseSync(join(this.root, definitions[source]), {
      readOnly: true,
    });
  }
  async initialize() {
    if (!this.initializing)
      this.initializing = this.build().catch((e) => {
        this.initializing = undefined;
        throw e;
      });
    await this.initializing;
  }
  private async build() {
    await mkdir(this.cache, { recursive: true });
    const index = new DatabaseSync(join(this.cache, "search.sqlite3"));
    index.exec(
      "CREATE TABLE IF NOT EXISTS records(source TEXT, record_id TEXT, title TEXT, summary TEXT, kind TEXT, search TEXT, locator TEXT, PRIMARY KEY(source,record_id)); CREATE TABLE IF NOT EXISTS meta(source TEXT PRIMARY KEY,stamp TEXT,status TEXT)",
    );
    const insert = index.prepare(
      "INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?,?)",
    );
    const status: HardwareStatus = {
      version: HARDWARE_VERSION,
      root: this.root,
      indexedAt: new Date().toISOString(),
      sources: [],
    };
    for (const source of hardwareSources) {
      let db: DatabaseSync | undefined;
      try {
        if (source === "curated") {
          this.curated.clear();
          const records = curatedRecords(
            JSON.parse(
              await readFile(join(this.cache, "curated.json"), "utf8"),
            ),
          );
          index.exec("BEGIN");
          index.prepare("DELETE FROM records WHERE source=?").run(source);
          for (const record of records) {
            this.curated.set(record.recordId, record);
            insert.run(
              source,
              record.recordId,
              record.title,
              record.summary,
              record.kind,
              [
                record.title,
                record.summary,
                record.sourceText,
                JSON.stringify(record.parameters),
              ]
                .join(" ")
                .toLowerCase(),
              record.recordId,
            );
          }
          index.exec("COMMIT");
          status.sources.push({
            source,
            name: hardwareSourceNames[source],
            state: records.length ? "ready" : "empty",
            count: records.length,
          });
          continue;
        }
        const info = await stat(join(this.root, definitions[source]));
        const stamp = `${HARDWARE_VERSION}:2:${this.root}:${info.size}:${info.mtimeMs}`;
        const previous = index
          .prepare("SELECT * FROM meta WHERE source=?")
          .get(source) as Row | undefined;
        if (previous?.stamp === stamp) {
          status.sources.push(parse(previous.status));
          continue;
        }
        db = this.database(source);
        let rows: Iterable<Row>;
        if (source === "seed")
          rows = db
            .prepare(
              "SELECT p.*,f.name family_name FROM parts p LEFT JOIN families f ON f.id=p.family_id",
            )
            .iterate() as Iterable<Row>;
        else if (source === "requirements")
          rows = db
            .prepare(
              "SELECT v.variant_id,v.label_zh,v.label_en,p.name_zh,p.name_en,p.family FROM variants v JOIN part_types p USING(part_id)",
            )
            .iterate() as Iterable<Row>;
        else if (source === "amazon")
          rows = db
            .prepare("SELECT run_id,url,title,variant_id,status FROM snapshots")
            .iterate() as Iterable<Row>;
        else if (source === "misumi")
          rows = db
            .prepare(
              "SELECT h.candidate_id,h.title,substr(h.primary_text,1,800) summary,substr(s.primary_text,1,500) series_text FROM hardware h LEFT JOIN misumi_models m ON m.candidate_id=h.candidate_id LEFT JOIN hardware s ON s.candidate_id=(SELECT candidate_id FROM misumi_series WHERE code=m.series_code)",
            )
            .iterate() as Iterable<Row>;
        else
          rows = db
            .prepare(
              "SELECT candidate_id,title,substr(primary_text,1,1000) summary FROM hardware",
            )
            .iterate() as Iterable<Row>;
        index.exec("BEGIN");
        index.prepare("DELETE FROM records WHERE source=?").run(source);
        let count = 0;
        for (const row of rows) {
          const id =
            source === "amazon"
              ? hash(`${row.run_id}\n${row.url}`)
              : row.variant_id || row.candidate_id || row.id;
          const title = row.title || row.label_zh || row.name;
          const summary = text(row.summary || row.purpose || row.label_en, 800);
          const kind =
            source === "requirements"
              ? "procurement_requirement"
              : source === "amazon"
                ? "marketplace_snapshot"
                : source === "seed"
                  ? row.record_kind
                  : "source_hardware";
          const search = [
            title,
            summary,
            row.series_text,
            row.model,
            row.family_name,
            row.name_en,
            row.name_zh,
            row.family,
            row.label_en,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          insert.run(
            source,
            id,
            title,
            summary,
            kind,
            search,
            source === "amazon" ? JSON.stringify([row.run_id, row.url]) : id,
          );
          count++;
        }
        const item: HardwareStatus["sources"][number] = {
          source,
          name: hardwareSourceNames[source],
          state: count ? "ready" : "empty",
          count,
          ...(count
            ? {}
            : { message: "源索引为空；保留空状态，不从备份恢复已删除记录" }),
        };
        index
          .prepare("INSERT OR REPLACE INTO meta VALUES(?,?,?)")
          .run(source, stamp, JSON.stringify(item));
        index.exec("COMMIT");
        status.sources.push(item);
      } catch (e) {
        if (source === "curated") this.curated.clear();
        try {
          index.exec("ROLLBACK");
        } catch {
          /* no active transaction */
        }
        // Never serve stale records when a source has disappeared or failed.
        index.prepare("DELETE FROM records WHERE source=?").run(source);
        index.prepare("DELETE FROM meta WHERE source=?").run(source);
        status.sources.push({
          source,
          name: hardwareSourceNames[source],
          state:
            (e as NodeJS.ErrnoException).code === "ENOENT"
              ? "missing"
              : "error",
          count: 0,
          message: (e as Error).message,
        });
      } finally {
        db?.close();
      }
    }
    this.index?.close();
    this.index = index;
    this.statusValue = status;
  }
  async status() {
    await this.initialize();
    return this.statusValue!;
  }
  async refresh() {
    this.initializing = undefined;
    await this.initialize();
    return this.statusValue!;
  }
  async search(query: string, source?: HardwareSource, limit = 10, offset = 0) {
    await this.initialize();
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8);
    const conditions = [
      source ? "source=?" : "1=1",
      ...terms.map(() => "instr(search,?)>0"),
    ];
    const params = [...(source ? [source] : []), ...terms];
    const where = conditions.join(" AND ");
    const count = this.index!.prepare(
      `SELECT count(*) count FROM records WHERE ${where}`,
    ).get(...params) as Row;
    let total = Number(count.count);
    let mode: "exact" | "relaxed" = "exact";
    let rows = this.index!.prepare(
      `SELECT source,record_id recordId,title,summary,kind FROM records WHERE ${where} ORDER BY CASE WHEN lower(title)=? THEN 0 WHEN instr(lower(title),?)>0 THEN 1 ELSE 2 END,source,title LIMIT ? OFFSET ?`,
    ).all(
      ...params,
      query.toLowerCase(),
      query.toLowerCase(),
      Math.min(30, Math.max(1, limit)),
      Math.max(0, offset),
    );
    if (total === 0 && query.trim()) {
      const relaxed = relaxedSearchTerms(query);
      if (relaxed.length) {
        const match = relaxed.map(() => "instr(search,?)>0").join(" OR ");
        const fallbackWhere = (source ? "source=? AND " : "") + `(${match})`;
        const values = [...(source ? [source] : []), ...relaxed];
        total = Number(
          (
            this.index!.prepare(
              `SELECT count(*) count FROM records WHERE ${fallbackWhere}`,
            ).get(...values) as Row
          ).count,
        );
        const score = relaxed.map(() => "(instr(search,?)>0)").join("+");
        rows = this.index!.prepare(
          `SELECT source,record_id recordId,title,summary,kind FROM records WHERE ${fallbackWhere} ORDER BY (${score}) DESC,source,title LIMIT ? OFFSET ?`,
        ).all(
          ...values,
          ...relaxed,
          Math.min(30, Math.max(1, limit)),
          Math.max(0, offset),
        );
        mode = "relaxed";
      }
    }
    return {
      version: HARDWARE_VERSION,
      total,
      searchMode: mode,
      ...(mode === "relaxed"
        ? {
            notice:
              "宽松相关结果，请逐项读取资料核对型号和用途；命中不表示匹配或已选型。",
          }
        : {}),
      items: rows as HardwareHit[],
    };
  }
  private async path(relative: string) {
    const root = await realpath(this.root);
    const file = await realpath(resolve(root, relative));
    if (!file.startsWith(root + sep)) throw new Error("资产路径超出硬件库");
    if (!(await stat(file)).isFile()) throw new Error("资产不是文件");
    return file;
  }
  async get(source: HardwareSource, recordId: string): Promise<HardwareRecord> {
    await this.initialize();
    const hit = this.index!.prepare(
      "SELECT * FROM records WHERE source=? AND record_id=?",
    ).get(source, recordId) as Row | undefined;
    if (!hit) throw new Error("硬件记录不存在，请重新检索");
    if (source === "curated") {
      const record = this.curated.get(recordId);
      if (!record) throw new Error("补充资料记录不存在，请刷新索引");
      return structuredClone(record);
    }
    const db = this.database(source);
    try {
      let raw: Row,
        parameters: unknown[] = [],
        assets: Row[] = [],
        documents: Row[] = [],
        sourceText = "",
        notes: string[] = [],
        url: unknown,
        capturedAt: unknown,
        evidence = "",
        kind = hit.kind;
      if (source === "amazon") {
        const [runId, productUrl] = parse(hit.locator, []);
        raw = db
          .prepare("SELECT * FROM snapshots WHERE run_id=? AND url=?")
          .get(runId, productUrl) as Row;
        let snapshot: Row = {};
        try {
          const file = await this.path(raw.raw_path);
          snapshot = parse(await readFile(file, "utf8")).snapshot || {};
        } catch {
          notes.push("商品原始快照文件缺失");
        }
        parameters = [
          { name: "采集状态", value: raw.status },
          { name: "商品规格原文", value: text(snapshot.parameters) },
          { name: "采集时所选变体", value: snapshot.selected || null },
          {
            name: "采集价格（历史，非当前报价）",
            value: {
              amount: raw.price_amount,
              currency: raw.currency,
              capturedAt: raw.captured_at,
            },
          },
        ];
        sourceText = text((snapshot.features || []).join("\n"));
        raw = { ...raw, snapshot };
        url = productUrl;
        capturedAt = raw.captured_at;
        evidence = "marketplace_claim_not_verified";
        notes.push(
          "电商页面描述不是厂商机械图；价格、库存与所选变体只代表采集时快照。不得从采购需求推导商品实际尺寸。",
          "关联采购需求ID：" + raw.variant_id,
        );
      } else if (source === "requirements") {
        raw = db
          .prepare(
            "SELECT v.*,p.name_zh,p.name_en,p.family FROM variants v JOIN part_types p USING(part_id) WHERE variant_id=?",
          )
          .get(recordId) as Row;
        parameters = parse(raw.specs_json, []);
        const usages = db
          .prepare(
            "SELECT condition_text,function_text,interfaces_json,custom_work,firmware FROM usages WHERE variant_id=? LIMIT 8",
          )
          .all(recordId) as Row[];
        sourceText = text(JSON.stringify(usages));
        notes = [
          "由模型整理的采购目标与产品架构，不是已确定供应商的实际元件，尺寸和额定值不能作为建模事实。",
          "标准引用：" + raw.standards_json,
        ];
        evidence = "requested_spec_not_supplier_fact";
        capturedAt = raw.created_at;
      } else if (source === "seed") {
        raw = db.prepare("SELECT * FROM parts WHERE id=?").get(recordId) as Row;
        parameters = db
          .prepare(
            "SELECT d.*,s.url source_url FROM dimensions d LEFT JOIN sources s ON s.id=d.source_id WHERE part_id=?",
          )
          .all(recordId);
        const sources = db
          .prepare(
            "SELECT s.* FROM sources s JOIN part_sources p ON p.source_id=s.id WHERE p.part_id=?",
          )
          .all(recordId) as Row[];
        parameters.push({
          name: "电压范围（库记录，兼容性待核对）",
          min: raw.voltage_min,
          max: raw.voltage_max,
          sources,
        });
        sourceText = text(raw.purpose + "\n" + raw.notes);
        notes = [
          "缺失字段：" + raw.missing_json,
          "尺寸中的 requested_spec 是采购目标，不是实际型号尺寸。",
        ];
        evidence =
          raw.record_kind === "exact_model"
            ? "seed_source_claim_not_physical_validation"
            : "requested_spec_not_supplier_fact";
        url = sources.find((s) => safeUrl(s.url))?.url;
        raw = { ...raw, sources, dimensions: parameters };
      } else {
        const row = db
          .prepare("SELECT * FROM hardware WHERE candidate_id=?")
          .get(recordId) as Row;
        if (!row) throw new Error("源记录已移除，请刷新索引");
        raw = parse(row.record_json);
        parameters = Array.isArray(raw.parameters) ? raw.parameters : [];
        if (raw.referenceEnvelopeMm)
          parameters = [
            ...parameters,
            {
              name: "来源给定参考包络 / XYZ mm（非产品装配验证）",
              value: raw.referenceEnvelopeMm,
            },
          ];
        sourceText = text(
          raw.sourceText || raw.specificationSource || row.primary_text,
        );
        notes = Array.isArray(raw.reviewNotes)
          ? raw.reviewNotes.map(String)
          : [];
        if (raw.sourceIncomplete) notes.push("源资料尚未完整下载或校核");
        url = raw.url || row.url;
        capturedAt = raw.capturedAt;
        evidence = raw.evidenceStatus || "source_claim_not_verified";
        kind = raw.kind || "manufacturer_hardware";
        assets = db
          .prepare(
            "SELECT a.* FROM assets a JOIN hardware_assets h ON h.asset_id=a.asset_id WHERE h.candidate_id=? ORDER BY CASE WHEN a.role='step_model' THEN 0 WHEN a.role LIKE '%step%' THEN 1 WHEN a.role='datasheet' THEN 2 ELSE 3 END,a.asset_id",
          )
          .all(recordId) as Row[];
        documents = db
          .prepare(
            "SELECT d.document_id id,d.title,d.url,d.sha256 FROM documents d JOIN hardware_documents h ON h.document_id=d.document_id WHERE h.candidate_id=?",
          )
          .all(recordId) as Row[];
      }
      const revision = hash(JSON.stringify({ raw, assets, documents }));
      const outputAssets: HardwareAsset[] = [];
      for (const a of assets.slice(0, 100)) {
        const provenance = parse(a.source_json);
        const coverage =
          provenance.coverage ||
          (a.role === "reference_step_model"
            ? "series_reference"
            : a.role === "step_model"
              ? "source_linked_model"
              : "document");
        let available = false;
        try {
          if (a.local_path) {
            await this.path(a.local_path);
            available = true;
          }
        } catch {
          /* missing or outside root */
        }
        outputAssets.push({
          id: a.asset_id,
          label: a.label,
          role: a.role,
          url: safeUrl(a.url),
          sha256: a.sha256 || undefined,
          state: a.state,
          available,
          coverage,
          bytes: a.bytes || undefined,
          downloadUrl: `/workbench-api/library/asset?source=${source}&recordId=${encodeURIComponent(recordId)}&assetId=${a.asset_id}${a.sha256 ? `&sha256=${a.sha256}` : ""}`,
        });
      }
      return {
        version: HARDWARE_VERSION,
        source,
        recordId,
        revision,
        itemId: `hw:${source}:${recordId}:${revision.slice(0, 16)}`,
        title: hit.title,
        summary: hit.summary,
        kind,
        url: safeUrl(url),
        capturedAt: text(capturedAt),
        evidence,
        parameters: parameters.slice(0, 100),
        sourceText,
        notes,
        assets: outputAssets,
        assetCount: assets.length,
        documents: documents
          .slice(0, 50)
          .map((d) => ({ id: d.id, title: d.title, url: safeUrl(d.url) })),
        documentCount: documents.length,
        physicalVerified: false,
        geometryVerified: false,
      };
    } finally {
      db.close();
    }
  }
  async asset(source: HardwareSource, recordId: string, assetId: string) {
    if (!["arduino", "raspberrypi", "misumi", "references"].includes(source))
      throw new Error("该来源没有登记的文件资产");
    const db = this.database(source);
    try {
      const a = db
        .prepare(
          "SELECT a.* FROM assets a JOIN hardware_assets h ON a.asset_id=h.asset_id WHERE h.candidate_id=? AND a.asset_id=?",
        )
        .get(recordId, assetId) as Row | undefined;
      if (!a?.local_path) throw new Error("此硬件没有该本地资产");
      const provenance = parse(a.source_json);
      if (provenance.coverage === "configured_model") {
        const owner = db
          .prepare("SELECT record_json FROM hardware WHERE candidate_id=?")
          .get(recordId) as Row | undefined;
        const partNumber = parse(owner?.record_json).partNumber;
        if (!partNumber || partNumber !== provenance.partNumber)
          throw new Error("CAD资产的具体型号与所选硬件不符，停止读取");
      }
      const file = await this.path(a.local_path);
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(file)) digest.update(chunk);
      if (!a.sha256 || digest.digest("hex") !== a.sha256)
        throw new Error("资产 SHA-256 与来源记录不符，停止读取");
      return {
        file,
        name: basename(file),
        sha256: a.sha256 as string,
        coverage:
          parse(a.source_json).coverage ||
          ((a.role === "reference_step_model"
            ? "series_reference"
            : "source_linked_model") as string),
      };
    } finally {
      db.close();
    }
  }
  async document(
    source: HardwareSource,
    recordId: string,
    documentId: string,
    offset = 0,
  ) {
    if (!["arduino", "raspberrypi", "misumi", "references"].includes(source))
      throw new Error("此来源未登记可读的关联资料正文");
    const db = this.database(source);
    try {
      const row = db
        .prepare(
          "SELECT d.* FROM documents d JOIN hardware_documents h ON d.document_id=h.document_id WHERE h.candidate_id=? AND d.document_id=?",
        )
        .get(recordId, documentId) as Row | undefined;
      if (!row) throw new Error("关联文档不存在");
      return {
        version: HARDWARE_VERSION,
        id: row.document_id,
        title: row.title,
        url: safeUrl(row.url),
        sha256: row.sha256,
        textSha256: hash(String(row.text)),
        text: String(row.text).slice(offset, offset + 12000),
        totalCharacters: String(row.text).length,
        offset,
      };
    } finally {
      db.close();
    }
  }
  async inspect(
    source: HardwareSource,
    recordId: string,
    assetId: string,
  ): Promise<HardwareGeometry> {
    const key = `${source}:${recordId}:${assetId}`;
    const existing = this.inspecting.get(key);
    if (existing) return existing;
    const job = this.inspectAsset(source, recordId, assetId).finally(() =>
      this.inspecting.delete(key),
    );
    this.inspecting.set(key, job);
    return job;
  }
  private async inspectAsset(
    source: HardwareSource,
    recordId: string,
    assetId: string,
  ): Promise<HardwareGeometry> {
    const record = await this.get(source, recordId);
    const asset = await this.asset(source, recordId, assetId);
    if (![".step", ".stp"].includes(extname(asset.file).toLowerCase()))
      throw new Error(
        "目前只检查登记的 STEP 几何；其他格式可下载后使用对应CAD工具",
      );
    const folder = join(this.cache, "geometry");
    await mkdir(folder, { recursive: true });
    const resultFile = join(folder, asset.sha256 + ".json"),
      meshFile = join(folder, asset.sha256 + ".stl");
    let bounds: Row;
    try {
      bounds = JSON.parse(await readFile(resultFile, "utf8"));
      await stat(meshFile);
    } catch {
      const tempMesh = join(folder, `${asset.sha256}-${randomUUID()}.stl`);
      try {
        const { stdout } = await run(
          this.python,
          [
            resolve("workers/workbench/inspect_hardware.py"),
            asset.file,
            tempMesh,
          ],
          { timeout: 90_000, maxBuffer: 1024 * 1024 },
        );
        bounds = JSON.parse(stdout.trim().split("\n").at(-1)!);
        const { rename } = await import("node:fs/promises");
        await rename(tempMesh, meshFile);
        await writeFile(resultFile, JSON.stringify(bounds), { mode: 0o600 });
      } catch {
        throw new Error(
          "STEP检查未成功；请配置可用的 WORKBENCH_GEOMETRY_PYTHON（需OCP）。不以估计尺寸代替实际几何。",
        );
      }
    }
    return {
      version: HARDWARE_VERSION,
      reference: { source, recordId, revision: record.revision },
      assetId,
      sha256: asset.sha256,
      coverage: asset.coverage,
      units: "mm",
      coordinateFrame: "source-cad-native/1",
      dimensionsMm: bounds.dimensionsMm,
      minMm: bounds.minMm,
      maxMm: bounds.maxMm,
      solidCount: bounds.solidCount,
      shapeValid: bounds.shapeValid,
      meshUrl: `/workbench-api/library/mesh?source=${source}&recordId=${encodeURIComponent(recordId)}&assetId=${assetId}&sha256=${asset.sha256}`,
      evidence: "executed_geometry_inspection",
      physicalVerified: false,
      assemblyVerified: false,
    };
  }
  async mesh(source: HardwareSource, recordId: string, assetId: string) {
    const asset = await this.asset(source, recordId, assetId);
    return {
      file: join(this.cache, "geometry", asset.sha256 + ".stl"),
      name: asset.sha256 + ".stl",
      sha256: asset.sha256,
    };
  }
  close() {
    this.index?.close();
    this.index = undefined;
    this.initializing = undefined;
  }
}
export const hardwareLibrary = new HardwareLibrary();
