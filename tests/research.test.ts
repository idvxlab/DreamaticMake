import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchReference,
  researchPolicy,
  allowedResearchURL,
  publicAddress,
  type ResearchTransport,
} from "../packages/core/src/research";

test("资料入口默认树莓派官方域名族，额外来源精确匹配且拒绝内网配置", () => {
  assert.deepEqual(researchPolicy().seeds, [
    "https://www.raspberrypi.com/products/",
  ]);
  for (const host of [
    "www.raspberrypi.com",
    "raspberrypi.com",
    "datasheets.raspberrypi.com",
    "pip.raspberrypi.com",
  ])
    assert.doesNotThrow(() => allowedResearchURL(`https://${host}/pico`));
  assert.throws(
    () => allowedResearchURL("https://evil.raspberrypi.com/pico"),
    /Settings/,
  );
  assert.throws(() =>
    allowedResearchURL("https://www.raspberrypi.com.evil.com/"),
  );
  assert.doesNotThrow(() =>
    allowedResearchURL(
      "https://learn.adafruit.com/pico",
      "https://learn.adafruit.com/",
    ),
  );
  assert.throws(() =>
    allowedResearchURL(
      "https://raspberrypi.com/",
      "https://learn.adafruit.com/",
    ),
  );
  for (const input of [
    "",
    "http://example.com/",
    "https://localhost/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://foo.internal/",
    "https://u:p@example.com/",
    "https://example.com:8443/",
  ])
    assert.throws(() => researchPolicy(input));
  for (const address of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.1.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("1.1.1.1"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
});
const page = (html: string, type = "text/html") => ({
  status: 200,
  headers: { "content-type": type },
  body: (async function* () {
    yield Buffer.from(html);
  })(),
});
test("网页提取使用 HTML 解析器，保留来源与未解析链接并过滤脚本", async () => {
  const reference = await fetchReference(
    "https://www.raspberrypi.com/products/",
    undefined,
    undefined,
    async () =>
      page(
        '<html><title>Pico &amp; docs</title><body><nav>noise</nav><main><h1>Pico &amp; RP2040</h1><p>21 × 51 mm</p><script>bad()</script><a href="/products/pico/">Pico</a><a href="https://datasheets.raspberrypi.com/pico/pico.pdf">Data sheet</a><a href="https://other.example.com/">Other</a><a href="javascript:alert(1)">Bad</a></main></body></html>',
      ),
  );
  assert.equal(reference.title, "Pico & docs");
  assert.match(reference.text, /Pico & RP2040/);
  assert.doesNotMatch(reference.text, /bad\(\)|noise/);
  assert.equal(reference.links.length, 3);
  assert.equal(
    reference.links[0].url,
    "https://www.raspberrypi.com/products/pico/",
  );
  assert.equal(reference.links[1].kind, "unparsed_document");
  assert.equal(reference.links[1].parsed, false);
  assert.equal(reference.links[2].allowed, false);
  assert.equal(
    reference.evidenceStatus,
    "fetched_text_not_independently_verified",
  );
});
test("跨域跳转在请求前拒绝，关闭响应；不把 PDF 当文本", async () => {
  let calls = 0,
    closed = false;
  const send: ResearchTransport = async () => {
    calls++;
    return {
      status: 302,
      headers: { location: "https://evil.example.com/" },
      body: {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: false, value: Buffer.from("redirect") }),
          return: async () => {
            closed = true;
            return { done: true, value: undefined };
          },
        }),
      },
    };
  };
  await assert.rejects(
    fetchReference("https://www.raspberrypi.com/", undefined, undefined, send),
    /未获允许/,
  );
  assert.equal(calls, 1);
  assert.equal(closed, true);
  await assert.rejects(
    fetchReference(
      "https://datasheets.raspberrypi.com/pico.pdf",
      undefined,
      undefined,
      async () => page("%PDF", "application/pdf"),
    ),
    /PDF/,
  );
});
test("抓取限制包含跳转、流式大小上限和取消", async () => {
  let calls = 0;
  await assert.rejects(
    fetchReference(
      "https://www.raspberrypi.com/",
      undefined,
      undefined,
      async () => {
        calls++;
        return { ...page(""), status: 302, headers: { location: "/redirect" } };
      },
    ),
    /超过 3 次/,
  );
  assert.equal(calls, 4);
  await assert.rejects(
    fetchReference(
      "https://www.raspberrypi.com/",
      undefined,
      undefined,
      async () => page("x".repeat(2_000_001), "text/plain"),
    ),
    /2MB/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchReference(
      "https://www.raspberrypi.com/",
      controller.signal,
      undefined,
      async () => {
        throw new Error("should not request");
      },
    ),
    /abort/i,
  );
  await assert.rejects(
    fetchReference(
      "https://www.raspberrypi.com/",
      undefined,
      undefined,
      async () => page("<script>app()</script>"),
    ),
    /正文/,
  );
});

test("人机验证返回明确资料缺口，不作为网页证据", async () => {
  await assert.rejects(
    fetchReference(
      "https://www.raspberrypi.com/products/",
      undefined,
      undefined,
      async () => ({
        ...page("challenge"),
        status: 403,
        headers: { "cf-mitigated": "challenge", "content-type": "text/html" },
      }),
    ),
    /Cloudflare.*不能完成验证/,
  );
});
