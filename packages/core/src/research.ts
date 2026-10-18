import { request } from "node:https";
import { lookup } from "node:dns";
import { isIP, BlockList } from "node:net";
import { loadBuffer } from "cheerio";
import { HttpError } from "./store";

export const defaultResearchSources = "https://www.raspberrypi.com/products/";
const raspberryHosts = [
  "raspberrypi.com",
  "www.raspberrypi.com",
  "datasheets.raspberrypi.com",
  "pip.raspberrypi.com",
];
const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(ip, prefix, "ipv4");
blocked.addSubnet("::", 128, "ipv6");
blocked.addSubnet("::1", 128, "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");
export function publicAddress(address: string) {
  const family = isIP(address);
  if (!family) return false;
  // IPv4-mapped IPv6 can otherwise bypass the IPv4 deny list.
  if (family === 6 && address.toLowerCase().startsWith("::ffff:")) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}
function sourceURL(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(400, "资料来源必须是完整 HTTPS 地址");
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    host.endsWith(".") ||
    isIP(host) ||
    host.startsWith("[") ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
  )
    throw new HttpError(
      400,
      "资料来源必须是公共 HTTPS 域名，不能包含凭据、端口或内网地址",
    );
  url.hash = "";
  return url;
}
export function researchPolicy(value = defaultResearchSources) {
  const inputs = value.split(/[,\s]+/).filter(Boolean);
  if (!inputs.length || inputs.length > 20)
    throw new HttpError(400, "请配置 1–20 个资料入口，以逗号或空格分隔");
  const seeds = [...new Set(inputs.map((v) => sourceURL(v).href))];
  const hosts = new Set(seeds.map((v) => new URL(v).hostname));
  if (raspberryHosts.some((host) => hosts.has(host)))
    raspberryHosts.forEach((host) => hosts.add(host));
  return {
    seeds,
    allowedHosts: [...hosts],
    capabilities:
      "提取静态 HTML 正文、标题及链接，支持文本/JSON；不执行 JavaScript，不解析 PDF/STEP，不自动核验尺寸、许可或电气参数。PDF/STEP 仅作为未解析链接返回。每页最多 2MB、20 秒、3 次跳转；批量最多 3 页。",
  };
}
export function allowedResearchURL(
  input: string,
  sources = defaultResearchSources,
) {
  const url = sourceURL(input),
    policy = researchPolicy(sources);
  if (!policy.allowedHosts.includes(url.hostname))
    throw new HttpError(
      400,
      `资料域名未获允许：${url.hostname}。请在 Settings → 资料抓取配置来源。允许域名：${policy.allowedHosts.join(", ")}`,
    );
  return url;
}
type Page = {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  close?: () => void;
};
export type ResearchTransport = (
  url: URL,
  signal: AbortSignal,
) => Promise<Page>;
// DNS is validated in the actual socket lookup, rather than in a separate preflight.
const transport: ResearchTransport = (url, signal) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        signal,
        headers: {
          Accept: "text/html,text/plain,application/json",
          "User-Agent": "DreamaticMake/0.1 (hardware reference reader)",
          "Accept-Encoding": "identity",
        },
        lookup: ((hostname: string, options: any, callback: any) => {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error) return callback(error);
            if (
              !addresses.length ||
              addresses.some((a) => !publicAddress(a.address))
            )
              return callback(
                new Error("资料域名解析到非公共地址，已拒绝访问"),
              );
            callback(
              null,
              options?.all ? addresses : addresses[0].address,
              addresses[0].family,
            );
          });
        }) as any,
      },
      (response) =>
        resolve({
          status: response.statusCode ?? 0,
          headers: Object.fromEntries(
            Object.entries(response.headers).map(([key, v]) => [
              key,
              Array.isArray(v) ? v.join(", ") : v,
            ]),
          ),
          body: response,
          close: () => response.destroy(),
        }),
    );
    req.on("error", reject);
    req.end();
  });
export async function fetchReference(
  input: string,
  signal?: AbortSignal,
  sources = defaultResearchSources,
  send: ResearchTransport = transport,
) {
  let url = allowedResearchURL(input, sources);
  const requestSignal = AbortSignal.any([
    signal ?? new AbortController().signal,
    AbortSignal.timeout(20000),
  ]);
  for (let redirect = 0; redirect <= 3; redirect++) {
    requestSignal.throwIfAborted();
    const response = await send(url, requestSignal);
    // Always close the response, including denied redirects and unsupported media.
    const reader = response.body[Symbol.asyncIterator]();
    try {
      if (response.status >= 300 && response.status < 400) {
        if (redirect === 3) throw new Error("资料重定向次数超过 3 次");
        if (!response.headers.location) throw new Error("无效重定向");
        url = allowedResearchURL(
          new URL(response.headers.location, url).href,
          sources,
        );
        continue;
      }
      if (response.headers["cf-mitigated"] === "challenge")
        throw new Error(
          "资料站点返回 Cloudflare 人机验证（HTTP " +
            response.status +
            "）；当前静态抓取不能完成验证。请在浏览器查看后提供可读资料，或在 Settings 添加其他官方静态来源；不要重复请求",
        );
      if (response.status < 200 || response.status >= 300)
        throw new Error(
          `资料请求失败：${response.status}；请更换资料或补充来源，不要重复请求相同地址`,
        );
      const type = response.headers["content-type"] ?? "";
      if (!/text\/|application\/(json|xhtml\+xml)/i.test(type))
        throw new Error(
          "资料工具仅解析 HTML、文本和 JSON；PDF/STEP 请保留为未解析链接，或请用户提供可读资料",
        );
      if (Number(response.headers["content-length"] ?? 0) > 2_000_000)
        throw new Error("资料超过 2MB 大小上限");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        requestSignal.throwIfAborted();
        const item = await reader.next();
        if (item.done) break;
        size += item.value.length;
        if (size > 2_000_000) throw new Error("资料超过 2MB 大小上限");
        chunks.push(item.value);
      }
      const buffer = Buffer.concat(chunks);
      const links: {
        url: string;
        title: string;
        allowed: boolean;
        parsed: false;
        kind: string;
      }[] = [];
      let title = "",
        text = buffer.toString("utf8");
      if (/html/i.test(type)) {
        const $ = loadBuffer(buffer);
        title = $("title").first().text().trim().slice(0, 300);
        $("script, style, noscript, template, nav, footer, header").remove();
        $("a[href]").each((_i, element) => {
          if (links.length >= 80) return;
          try {
            const href = new URL($(element).attr("href")!, url);
            href.hash = "";
            if (
              href.protocol !== "https:" ||
              href.username ||
              href.password ||
              links.some((l) => l.url === href.href)
            )
              return;
            let allowed = true;
            try {
              allowedResearchURL(href.href, sources);
            } catch {
              allowed = false;
            }
            links.push({
              url: href.href,
              title: $(element)
                .text()
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 160),
              allowed,
              parsed: false,
              kind: /\.(pdf|step|stp)(?:$|\?)/i.test(href.href)
                ? "unparsed_document"
                : "page",
            });
          } catch {
            /* Invalid links are data, not instructions. */
          }
        });
        $("p, div, h1, h2, h3, h4, li, tr, td, br").append(" ");
        const main = $("main, article, [role=main]").first();
        text = (main.length ? main : $("body")).text();
      }
      text = text.replace(/\s+/g, " ").trim();
      if (!text)
        throw new Error(
          "页面没有可提取正文；可能需要 JavaScript，请提供静态资料或发布问题卡",
        );
      return {
        url: url.href,
        requestedUrl: input,
        fetchedAt: new Date().toISOString(),
        contentType: type,
        title,
        text: text.slice(0, 30000),
        truncated: text.length > 30000,
        links,
        evidenceStatus: "fetched_text_not_independently_verified",
      };
    } finally {
      try {
        await reader.return?.();
      } finally {
        response.close?.();
      }
    }
  }
  throw new Error("资料重定向次数过多");
}
