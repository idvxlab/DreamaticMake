import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkbenchAuth, SESSION_SECONDS } from "../packages/workbench/auth";
import { Workbench } from "../packages/workbench/runtime";
import { makeServer } from "../apps/workbench/server";
import { connectionStore } from "../packages/workbench/connection";
import { fixtureCaller } from "./workbench-fixtures";

test("persistent authentication survives a server restart and renews a near-expiry browser session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-auth-"));
  const start = async () => {
    const auth = await WorkbenchAuth.load(dir);
    const { server } = makeServer(
      new Workbench(fixtureCaller, dir),
      undefined,
      connectionStore,
      auth,
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    assert(address && typeof address === "object");
    return { auth, server, base: `http://127.0.0.1:${address.port}` };
  };
  let running: Awaited<ReturnType<typeof start>> | undefined;
  const stop = async () => {
    await new Promise<void>((r, j) =>
      running!.server.close((e) => (e ? j(e) : r())),
    );
    running = undefined;
  };
  try {
    running = await start();
    const bootstrap = running.auth.token;
    const login = await fetch(running.base + "/workbench-api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workbench": "1" },
      body: JSON.stringify({ token: bootstrap }),
    });
    assert.equal(login.status, 200);
    const header = login.headers.get("set-cookie")!;
    assert.match(header, /HttpOnly; SameSite=Strict/);
    assert.match(header, new RegExp(`Max-Age=${SESSION_SECONDS}`));
    const cookie = header.split(";")[0];
    await stop();
    // Simulate older file permissions being tightened again at startup.
    await chmod(join(dir, "auth.json"), 0o644);
    running = await start();
    assert.equal(running.auth.token, bootstrap);
    assert.equal((await stat(join(dir, "auth.json"))).mode & 0o777, 0o600);
    const project = await fetch(running.base + "/workbench-api/project", {
      headers: { Cookie: cookie },
    });
    assert.equal(project.status, 200);
    assert.equal(project.headers.get("set-cookie"), null);
    assert.equal(
      (await fetch(running.base + "/workbench-api/project")).status,
      401,
    );
    const oldSession = running.auth.createSession(
      Date.now() - 350 * 24 * 60 * 60 * 1000,
    );
    const renewed = await fetch(running.base + "/workbench-api/project", {
      headers: { Cookie: `dreamatic_workbench=${oldSession}` },
    });
    assert.equal(renewed.status, 200);
    assert.match(
      renewed.headers.get("set-cookie")!,
      new RegExp(`Max-Age=${SESSION_SECONDS}`),
    );
  } finally {
    if (running) await stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("signed sessions reject changes, expiration, malformed values and a different local installation", () => {
  const auth = new WorkbenchAuth();
  const now = Date.now();
  const session = auth.createSession(now);
  assert.equal(auth.expiresAt(session, now), now + SESSION_SECONDS * 1000);
  assert.equal(
    auth.expiresAt(session, now + SESSION_SECONDS * 1000),
    undefined,
  );
  assert.equal(auth.expiresAt("invalid", now), undefined);
  const [expires, nonce, signature] = session.split(".");
  const changed = signature[0] === "a" ? "b" : "a";
  assert.equal(
    auth.expiresAt(`${expires}.${nonce}.${changed}${signature.slice(1)}`, now),
    undefined,
  );
  assert.equal(
    auth.expiresAt(`${Number(expires) + 1}.${nonce}.${signature}`, now),
    undefined,
  );
  assert.equal(new WorkbenchAuth().expiresAt(session, now), undefined);
});
