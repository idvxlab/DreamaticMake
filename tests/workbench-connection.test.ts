import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConnectionStore,
  selectModelId,
  suggestModels,
  createRoleModel,
} from "../packages/workbench/connection";
import { roles } from "../packages/workbench/contracts";
import { Workbench } from "../packages/workbench/runtime";
import { makeServer } from "../apps/workbench/server";
const KEY = "!test-only-literal-secret";
const ids = [
  "deepseek-flash",
  "kimi-k3.1-pro",
  "kimi-k3",
  "kimi-k3.1-pro-highspeed",
];
const settings = {
  baseUrl: "https://gateway.example/v1",
  apiKey: KEY,
  generalModel: "deepseek-flash",
  cadModel: "kimi-k3.1-pro",
};
function fetcher(): typeof fetch {
  return (async (url: URL | RequestInfo, init?: RequestInit) => {
    assert.equal(String(url), "https://gateway.example/v1/models");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      `Bearer ${KEY}`,
    );
    assert.equal(init?.redirect, "error");
    return Response.json({ data: ids.map((id) => ({ id })) });
  }) as typeof fetch;
}
test("only structural/CAD role uses Kimi; defaults do not guess nonexistent model IDs", () => {
  for (const role of roles)
    assert.equal(
      selectModelId(settings, role),
      role === "mechanical" ? "kimi-k3.1-pro" : "deepseek-flash",
    );
  assert.deepEqual(suggestModels(ids), {
    generalModel: "deepseek-flash",
    cadModel: "kimi-k3.1-pro",
  });
  assert.equal(suggestModels(["kimi-some-other-version"]).cadModel, "");
});
test("verified connection stays private, preserves blank key, and refuses forwarding a saved key to another host", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-connection-"));
  try {
    const store = new ConnectionStore(dir, fetcher());
    const catalog = await store.catalog({
      baseUrl: settings.baseUrl,
      apiKey: KEY,
    });
    assert.equal(catalog.models.length, 4);
    const value = await store.save(settings);
    assert(value.hasKey);
    assert(!JSON.stringify(value).includes(KEY));
    assert(!("apiKey" in value));
    assert.equal(
      (await stat(join(dir, "connection.json"))).mode & 0o777,
      0o600,
    );
    await store.save({ ...settings, apiKey: "" });
    assert((await store.public()).hasKey);
    await assert.rejects(
      () => store.catalog({ baseUrl: "https://other.example/v1" }),
      /填写/,
    );
    await assert.rejects(
      () => store.save({ ...settings, cadModel: "invented-kimi" }),
      /不在/,
    );
    await assert.rejects(() =>
      store.catalog({
        baseUrl: "https://user:pass@gateway.example/v1",
        apiKey: KEY,
      }),
    );
    await assert.rejects(() =>
      store.catalog({ baseUrl: "http://gateway.example/v1", apiKey: KEY }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("upstream authentication error bodies never disclose credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-connection-"));
  try {
    const store = new ConnectionStore(
      dir,
      (async () =>
        new Response(`upstream echoed ${KEY}`, {
          status: 401,
        })) as typeof fetch,
    );
    await assert.rejects(
      () => store.catalog({ baseUrl: settings.baseUrl, apiKey: KEY }),
      (e) =>
        e instanceof Error &&
        /认证/.test(e.message) &&
        !e.message.includes(KEY),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("real pinned Pi SDK registers the selected custom endpoint with a literal runtime credential and no fallback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-pi-routing-"));
  try {
    const store = new ConnectionStore(dir, fetcher());
    await store.save(settings);
    for (const role of ["coordinator", "mechanical"] as const) {
      const routing = await createRoleModel(role, store, join(dir, "sdk"));
      assert.equal(routing.model.id, selectModelId(settings, role));
      assert.deepEqual(
        routing.model.samplingParams,
        role === "mechanical"
          ? undefined
          : {
              response_format: { type: "json_object" },
              thinking: { type: "disabled" },
              reasoning_effort: "none",
            },
      );
      assert.equal(
        (
          routing.model.compat as
            | { supportsDeveloperRole?: boolean }
            | undefined
        )?.supportsDeveloperRole,
        role === "mechanical" ? false : undefined,
      );
      assert.equal(routing.model.baseUrl, settings.baseUrl);
      assert.equal(routing.model.provider, "workbench-gateway");
      assert.equal(
        routing.thinkingLevel,
        role === "mechanical" ? "low" : "off",
      );
      assert(
        JSON.stringify(
          await routing.modelRuntime.getAuth(routing.model),
        ).includes(KEY),
      );
      assert(!routing.redactError(`error ${KEY}`).includes(KEY));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("settings API requires authentication and only returns sanitized connection data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-settings-api-"));
  const store = new ConnectionStore(dir, fetcher());
  const { server } = makeServer(
    new Workbench(undefined, join(dir, "project")),
    "fixture-token",
    store,
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  assert(a && typeof a === "object");
  const base = `http://127.0.0.1:${a.port}`;
  const headers = { "Content-Type": "application/json", "X-Workbench": "1" };
  try {
    assert.equal((await fetch(base + "/workbench-api/connection")).status, 401);
    const login = await fetch(base + "/workbench-api/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: "fixture-token" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const result = await fetch(base + "/workbench-api/connection", {
      method: "POST",
      headers: { ...headers, Cookie: cookie },
      body: JSON.stringify(settings),
    });
    assert.equal(result.status, 200);
    assert(!(await result.text()).includes(KEY));
    const result2 = await fetch(base + "/workbench-api/connection", {
      headers: { Cookie: cookie },
    });
    const text = await result2.text();
    assert(!text.includes(KEY));
    assert(!text.includes("apiKey"));
    const invalid = await fetch(base + "/workbench-api/connection", {
      method: "POST",
      headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ ...settings, apiKey: { secret: KEY } }),
    });
    assert.equal(invalid.status, 400);
    assert(!(await invalid.text()).includes(KEY));
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await rm(dir, { recursive: true, force: true });
  }
});
