import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { Settings } from "../packages/core/src/settings";
import { createApp } from "../apps/server/src/index";

test("采购库 HTTP 读取实时参数、保持项目不变、拒绝无效查询及跨站请求", async () => {
  const folder = await mkdtemp(join(tmpdir(), "make-library-"));
  const source = join(folder, "source");
  const work = join(source, "jd_purchase/runs/amazon_batch");
  const config = join(folder, "config");
  await mkdir(work, { recursive: true });
  await mkdir(config);
  const url = "https://www.amazon.com/dp/TEST123";
  const rawPath = join(work, "raw.json");
  await writeFile(
    rawPath,
    JSON.stringify({
      snapshot: {
        asin: "TEST123",
        url,
        title: "USB fan",
        features: ["Voltage 5V"],
        parameters: "",
      },
    }),
  );
  execFileSync("/usr/bin/python3", [
    "-c",
    "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('CREATE TABLE snapshots(run_id,variant_id,asin,url,title,status,raw_path,captured_at)'); c.execute('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?)',('run','v1','TEST123',sys.argv[2],'USB fan','captured',sys.argv[3],'2026-10-21')); c.commit()",
    join(work, "purchase.sqlite3"),
    url,
    rawPath,
  ]);
  const settings = new Settings(config);
  await settings.save({
    MAKE_LOCAL_LIBRARY: source,
    MAKE_PYTHON: "/usr/bin/python3",
  });
  const app = await createApp(join(folder, "workspace"), settings);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as any).port}/api/local-library`;
  try {
    const p = await app.store.create("小风扇", "USB 供电");
    const before = await readFile(
      join(app.store.dir(p.id), "project.json"),
      "utf8",
    );
    const first = await (
      await fetch(base + "?q=" + encodeURIComponent("风扇"))
    ).json();
    assert.equal(first.candidates.length, 1);
    assert.equal(first.candidates[0].parameterCount, 0);
    await writeFile(
      join(work, "raw.flash.json"),
      JSON.stringify({
        result: {
          asin: "TEST123",
          url,
          parameters: [{ name: "voltage", value: "5V", quote: "Voltage 5V" }],
          fit: "candidate",
        },
      }),
    );
    const second = await (await fetch(base + "?q=fan")).json();
    assert.notEqual(first.fingerprint, second.fingerprint);
    assert.equal(second.candidates[0].parameters[0].value, "5V");
    const detail = await (
      await fetch(base + "?candidateId=" + second.candidates[0].candidateId)
    ).json();
    assert.match(detail.record.sourceText, /Voltage 5V/);
    assert.equal(detail.record.geometryVerified, false);
    assert.equal(
      await readFile(join(app.store.dir(p.id), "project.json"), "utf8"),
      before,
    );
    assert.equal((await fetch(base + "?candidateId=../secret")).status, 400);
    assert.equal(
      (await fetch(base, { headers: { Origin: "https://evil.example" } }))
        .status,
      403,
    );
    await settings.save({ MAKE_LOCAL_LIBRARY: "" });
    assert.equal((await (await fetch(base)).json()).enabled, false);
  } finally {
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});
