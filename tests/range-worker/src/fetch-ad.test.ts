import { checkPublicUrl, fetchAdText, htmlToText } from "@range-worker/fetch-ad";

function page(body: string, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

describe("checkPublicUrl — the SSRF refusals", () => {
  it.each([
    ["http://careers.acme.example/jobs/1", "https"],
    ["ftp://careers.acme.example/", "https"],
    ["https://localhost/jobs", "not a public host"],
    ["https://jobs.localhost/", "not a public host"],
    ["https://intranet.local/", "not a public host"],
    ["https://hr.internal/", "not a public host"],
    ["https://careers/", "not a public host"],
    ["https://127.0.0.1/", "private, loopback"],
    ["https://127.1.2.3/", "private, loopback"],
    ["https://10.0.0.5/", "private, loopback"],
    ["https://172.16.4.1/", "private, loopback"],
    ["https://192.168.1.10/", "private, loopback"],
    ["https://169.254.169.254/latest/meta-data", "private, loopback"],
    ["https://100.64.0.1/", "private, loopback"],
    ["https://0.0.0.0/", "private, loopback"],
    ["https://2130706433/", "private, loopback"],
    ["https://0x7f.0.0.1/", "private, loopback"],
    ["https://[::1]/", "IPv6"],
    ["https://[fd00::1]/", "IPv6"],
    ["https://careers.acme.example:8443/", "Port 8443"],
    ["https://careers.acme.example:22/", "Port 22"],
    ["https://user:pw@careers.acme.example/", "user name or password"],
    ["not a url", "Not a URL"],
  ])("refuses %s", (url, why) => {
    const v = checkPublicUrl(url);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain(why);
  });

  it.each(["https://careers.acme.example/jobs/42", "https://boards.example.com/acme/jobs/1?src=x", "https://careers.acme.example:443/a", "https://93.184.215.14/"])(
    "accepts %s",
    (url) => {
      expect(checkPublicUrl(url).ok).toBe(true);
    },
  );
});

describe("fetchAdText", () => {
  it("fetches a page and strips it to text", async () => {
    const calls: string[] = [];
    const r = await fetchAdText("https://careers.acme.example/jobs/1", {
      fetchImpl: (async (url: string) => {
        calls.push(url);
        return page(
          `<html><head><title>x</title><style>.a{}</style></head><body><script>var pay="$1";</script><h1>Analyst</h1><p>Salary: $80,000&nbsp;&ndash; $95,000 per year.</p><ul><li>Medical</li><li>401(k)</li></ul></body></html>`,
        );
      }) as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ status: "ok" });
    if (r.status === "ok") {
      expect(r.text).toContain("Salary: $80,000 – $95,000 per year.");
      expect(r.text).toContain("• Medical");
      expect(r.text).not.toContain("var pay");
    }
    expect(calls).toEqual(["https://careers.acme.example/jobs/1"]);
  });

  it("follows a redirect only to another public URL", async () => {
    const hops: Record<string, Response> = {
      "https://careers.acme.example/a": new Response(null, { status: 302, headers: { location: "https://jobs.acme.example/b" } }),
      "https://jobs.acme.example/b": page("<p>Pay $20–$24/hour</p>"),
    };
    const ok = await fetchAdText("https://careers.acme.example/a", { fetchImpl: (async (u: string) => hops[u]!) as unknown as typeof fetch });
    expect(ok).toMatchObject({ status: "ok", finalUrl: "https://jobs.acme.example/b" });

    const bad = await fetchAdText("https://careers.acme.example/a", {
      fetchImpl: (async () => new Response(null, { status: 301, headers: { location: "http://127.0.0.1:8080/admin" } })) as unknown as typeof fetch,
    });
    expect(bad.status).toBe("refused");
    if (bad.status !== "ok") expect(bad.error).toContain("Redirected to a refused URL");
  });

  it("caps the size: a declared length over 1 MB and a stream that runs over are both refused", async () => {
    const declared = await fetchAdText("https://careers.acme.example/big", {
      fetchImpl: (async () => page("x", { "content-length": "2000000" })) as unknown as typeof fetch,
    });
    expect(declared.status).toBe("too_large");
    const streamed = await fetchAdText("https://careers.acme.example/big", {
      maxBytes: 1000,
      fetchImpl: (async () => page("a".repeat(5000))) as unknown as typeof fetch,
    });
    expect(streamed.status).toBe("too_large");
  });

  it("refuses what is not a web page, reports HTTP errors, and times out", async () => {
    const pdf = await fetchAdText("https://careers.acme.example/x.pdf", {
      fetchImpl: (async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch,
    });
    expect(pdf.status).toBe("refused");
    const missing = await fetchAdText("https://careers.acme.example/gone", { fetchImpl: (async () => page("", {}, 404)) as unknown as typeof fetch });
    expect(missing).toMatchObject({ status: "failed", error: "The page answered HTTP 404" });
    const slow = await fetchAdText("https://careers.acme.example/slow", {
      timeoutMs: 30,
      fetchImpl: ((_u: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        })) as unknown as typeof fetch,
    });
    expect(slow).toMatchObject({ status: "failed", error: "The page did not answer within 10 s" });
  });

  it("never fetches a refused URL at all", async () => {
    let called = false;
    const r = await fetchAdText("https://169.254.169.254/latest", {
      fetchImpl: (async () => {
        called = true;
        return page("");
      }) as unknown as typeof fetch,
    });
    expect(r.status).toBe("refused");
    expect(called).toBe(false);
  });
});

describe("htmlToText", () => {
  it("decodes entities and keeps block breaks", () => {
    expect(htmlToText("<div>A&amp;B</div><div>&#8364;45.000 &#x2013; &euro;55.000</div>")).toBe("A&B\n€45.000 – €55.000");
  });
});
