import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { HardwareLibrary } from "../packages/workbench/hardware";

export async function hardwareFixture(directory: string) {
  const root = join(directory, "source"),
    cache = join(directory, "cache");
  const make = async (file: string, sql: string) => {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(sql);
    return db;
  };
  const officialSql =
    "CREATE TABLE hardware(candidate_id TEXT PRIMARY KEY,url TEXT,title TEXT,primary_text TEXT,search_text TEXT,record_json TEXT);CREATE TABLE assets(asset_id TEXT PRIMARY KEY,url TEXT,local_path TEXT,sha256 TEXT,mime TEXT,label TEXT,role TEXT,bytes INTEGER,state TEXT,source_json TEXT);CREATE TABLE hardware_assets(candidate_id TEXT,asset_id TEXT);CREATE TABLE documents(document_id TEXT PRIMARY KEY,url TEXT,title TEXT,text TEXT,sha256 TEXT);CREATE TABLE hardware_documents(candidate_id TEXT,document_id TEXT);";
  const record = {
    title: "Fixture Nano board",
    parameters: [
      { name: "Voltage", value: "3.3V", verification: "manufacturer_stated" },
      {
        name: "Tolerance",
        value: "TO VERIFY",
        verification: "requires_verification",
      },
    ],
    sourceText: "Manufacturer source data, not assembly validation",
    evidenceStatus: "manufacturer_documentation_not_physical_validation",
    geometryVerified: false,
    capturedAt: "2026-10-22",
    reviewNotes: ["Header clearance unknown"],
  };
  const db = await make(
    "official_catalog/library/hardware.sqlite3",
    officialSql,
  );
  db.prepare("INSERT INTO hardware VALUES(?,?,?,?,?,?)").run(
    "board",
    "https://example.com/board",
    record.title,
    "温度 sensor board",
    "",
    JSON.stringify(record),
  );
  await mkdir(join(root, "files"));
  await writeFile(join(root, "files", "model.step"), "fixture STEP bytes");
  const sha = createHash("sha256").update("fixture STEP bytes").digest("hex");
  db.prepare("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    "model",
    "https://example.com/model.step",
    "files/model.step",
    sha,
    "application/step",
    "Board STEP",
    "step_model",
    18,
    "downloaded",
    "{}",
  );
  db.prepare("INSERT INTO hardware_assets VALUES(?,?)").run("board", "model");
  db.prepare("INSERT INTO documents VALUES(?,?,?,?,?)").run(
    "manual",
    "https://example.com/manual",
    "Fixture pinout manual",
    "Pin 1 = GND; tolerance unknown",
    "manual-hash",
  );
  db.prepare("INSERT INTO hardware_documents VALUES(?,?)").run(
    "board",
    "manual",
  );
  db.close();
  const pi = await make(
    "official_catalog/library/raspberrypi.sqlite3",
    officialSql,
  );
  pi.close();
  const misumi = await make(
    "official_catalog/library/misumi.sqlite3",
    officialSql +
      "CREATE TABLE misumi_models(candidate_id TEXT,series_code TEXT);CREATE TABLE misumi_series(code TEXT,candidate_id TEXT);",
  );
  misumi
    .prepare("INSERT INTO hardware VALUES(?,?,?,?,?,?)")
    .run(
      "series",
      "https://example.com/series",
      "MISUMI fixture",
      "滑台 actuator",
      "",
      JSON.stringify({ ...record, kind: "manufacturer_series" }),
    );
  misumi
    .prepare("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(
      "reference",
      "https://example.com/reference.step",
      "files/model.step",
      sha,
      "application/step",
      "Reference STEP",
      "reference_step_model",
      18,
      "downloaded",
      JSON.stringify({ coverage: "series_reference" }),
    );
  misumi
    .prepare("INSERT INTO hardware_assets VALUES(?,?)")
    .run("series", "reference");
  misumi.close();
  const req = await make(
    "parts_library/data/parts_library.sqlite3",
    "CREATE TABLE part_types(part_id TEXT,name_zh TEXT,name_en TEXT,family TEXT);CREATE TABLE variants(variant_id TEXT,part_id TEXT,label_zh TEXT,label_en TEXT,specs_json TEXT,standards_json TEXT,created_at TEXT);CREATE TABLE usages(variant_id TEXT,condition_text TEXT,function_text TEXT,interfaces_json TEXT,custom_work TEXT,firmware TEXT);",
  );
  req.exec(
    "INSERT INTO part_types VALUES('part','鼠标模块','Mouse module','controller');INSERT INTO variants VALUES('variant','part','鼠标模块（未定规格）','Mouse module specs TBD','[{\"value\":null}]','[]','2026-10-18');",
  );
  req.close();
  const amazon = await make(
    "jd_purchase/runs/amazon_batch/purchase.sqlite3",
    "CREATE TABLE snapshots(run_id TEXT,variant_id TEXT,asin TEXT,url TEXT,title TEXT,price_amount REAL,currency TEXT,status TEXT,raw_path TEXT,captured_at TEXT);",
  );
  await writeFile(
    join(root, "files", "amazon.json"),
    JSON.stringify({
      snapshot: {
        features: ["Seller claim"],
        parameters: "Model\tfixture",
        selected: { color: "black" },
      },
    }),
  );
  amazon
    .prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(
      "run",
      "variant",
      "ASIN",
      "https://amazon.com/dp/ASIN",
      "Fixture mouse",
      10,
      "USD",
      "captured",
      "files/amazon.json",
      "2026-10-20",
    );
  amazon.close();
  return new HardwareLibrary(root, cache);
}
