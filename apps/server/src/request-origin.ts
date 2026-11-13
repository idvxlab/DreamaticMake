import type { IncomingHttpHeaders } from "node:http";

export function isSameOriginRequest(headers: IncomingHttpHeaders, expectedOrigin: string): boolean {
  // Fetch Metadata describes the browser-facing origin even when a local proxy
  // rewrites Host or the browser omits Origin on a same-origin request.
  const fetchSite = headers["sec-fetch-site"];
  if (fetchSite !== undefined) return fetchSite === "same-origin";
  if (headers.origin !== undefined) return headers.origin === expectedOrigin;
  if (!headers.referer) return false;
  try {
    return new URL(headers.referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}
