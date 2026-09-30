import { PAY_CHECK_AD_MAX, WATCH_FETCH_MAX_BYTES, WATCH_FETCH_TIMEOUT_MS } from "@saas/contracts/range";

/**
 * Fetch a saved ad's public careers page (RW3). The URL came from a user, so
 * this is an SSRF surface and every rule here is a refusal:
 *
 * - `https:` only, no credentials in the URL, and port 443 (none written);
 * - a host NAME with a dot: no `localhost`, `*.localhost`, `*.local`,
 *   `*.internal`, `*.home.arpa`, no IPv6 literal, and no IPv4 literal in a
 *   private, loopback, link-local, carrier-grade NAT, benchmarking, multicast
 *   or reserved range (the WHATWG parser has already turned `2130706433` or
 *   `0x7f.1` into dotted decimal, so those are caught too);
 * - redirects are followed by hand, at most 3, and each target passes the same
 *   test before it is fetched;
 * - a 10 s timeout, only text/html, text/plain or XHTML, and at most 1 MB read
 *   (a larger declared length is refused before reading; a stream that runs
 *   over is cut off and refused).
 *
 * Cloudflare's own fetch does not connect to private addresses either, which
 * covers a public name that resolves to one (DNS rebinding); the checks here
 * make the refusal explicit and testable.
 */

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** True for every IPv4 address that is not public unicast. */
export function isNonPublicIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

/** Is this a URL the worker may fetch? */
export function checkPublicUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Not a URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only https:// careers-page URLs are fetched" };
  if (url.username || url.password) return { ok: false, reason: "A URL with a user name or password is not accepted" };
  if (url.port !== "" && url.port !== "443") return { ok: false, reason: `Port ${url.port} is not accepted; only the standard https port` };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "The URL has no host" };
  if (host.startsWith("[") || host.includes(":")) return { ok: false, reason: "An IPv6 address is not accepted; use the page's host name" };
  const v4 = ipv4(host);
  if (v4) {
    if (isNonPublicIpv4(v4)) return { ok: false, reason: `${host} is a private, loopback or reserved address` };
    return { ok: true, url };
  }
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: `${host} is not a public host name` };
  if (!host.includes(".")) return { ok: false, reason: `${host} is not a public host name` };
  return { ok: true, url };
}

export type FetchResult =
  | { status: "ok"; text: string; finalUrl: string }
  | { status: "refused" | "failed" | "too_large"; error: string };

const ACCEPTED_TYPES = /^(?:text\/html|text\/plain|application\/xhtml\+xml)\b/i;
const MAX_REDIRECTS = 3;

async function readCapped(res: Response, maxBytes: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  if (!res.body) return { ok: true, bytes: new Uint8Array() };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, bytes: out };
}

export async function fetchAdText(
  raw: string,
  opts: { fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {},
): Promise<FetchResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? WATCH_FETCH_MAX_BYTES;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? WATCH_FETCH_TIMEOUT_MS);
  let current = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const verdict = checkPublicUrl(current);
      if (!verdict.ok) return { status: "refused", error: hop ? `Redirected to a refused URL: ${verdict.reason}` : verdict.reason };
      const res = await doFetch(verdict.url.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { accept: "text/html, text/plain;q=0.9", "user-agent": "Rangewise pay-transparency checker (+https://rangewise.app)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location) return { status: "failed", error: `HTTP ${res.status} without a Location` };
        current = new URL(location, verdict.url).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        await res.body?.cancel().catch(() => undefined);
        return { status: "failed", error: `The page answered HTTP ${res.status}` };
      }
      const type = res.headers.get("content-type") ?? "";
      if (!ACCEPTED_TYPES.test(type)) {
        await res.body?.cancel().catch(() => undefined);
        return { status: "refused", error: `Not a web page (content-type ${type || "missing"})` };
      }
      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        return { status: "too_large", error: `The page is larger than ${maxBytes} bytes` };
      }
      const body = await readCapped(res, maxBytes);
      if (!body.ok) return { status: "too_large", error: `The page is larger than ${maxBytes} bytes` };
      const decoded = new TextDecoder("utf-8").decode(body.bytes);
      const text = /html/i.test(type) ? htmlToText(decoded) : decoded.trim();
      if (!text) return { status: "failed", error: "The page has no text" };
      return { status: "ok", text: text.slice(0, PAY_CHECK_AD_MAX), finalUrl: verdict.url.toString() };
    }
    return { status: "failed", error: `More than ${MAX_REDIRECTS} redirects` };
  } catch (err) {
    // AbortSignal.timeout() rejects with a DOMException, which is not always an Error subclass.
    const name = typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "";
    return { status: "failed", error: name === "TimeoutError" || name === "AbortError" ? "The page did not answer within 10 s" : "The page could not be fetched" };
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", euro: "€", pound: "£",
  dollar: "$", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", middot: "·", zwnj: "", zwj: "",
};

/** Careers-page HTML to plain text: drop scripts, styles and markup, keep block breaks, decode entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|header|footer|ul|ol|table|dd|dt|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeChar(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}
