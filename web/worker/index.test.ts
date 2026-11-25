// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { MAX_ASSET_BYTES, readCapped } from "./routes";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const call = (path: string, init?: RequestInit) =>
  (worker.fetch as unknown as (r: Request, e: unknown, c: ExecutionContext) => Promise<Response>)(new Request(`https://multikeys.mewis.me${path}`, init), {}, ctx);

function stubCache() {
  vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
}

/** A body of `size` bytes with no Content-Length header, produced in 1 MiB chunks. */
function unsizedBody(size: number): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const n = Math.min(1024 * 1024, size - sent);
      if (n === 0) return controller.close();
      sent += n;
      controller.enqueue(new Uint8Array(n));
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe("readCapped", () => {
  it("returns the bytes up to the cap and null above it", async () => {
    const small = await readCapped(new Response(new Uint8Array(10)).body, 10);
    expect(small?.byteLength).toBe(10);
    expect(await readCapped(new Response(new Uint8Array(11)).body, 10)).toBeNull();
    expect((await readCapped(null, 10))?.byteLength).toBe(0);
  });
});

describe("worker", () => {
  it("refuses an asset over the cap even when upstream sends no Content-Length", async () => {
    stubCache();
    vi.stubGlobal("fetch", async () => unsizedBody(MAX_ASSET_BYTES + 1));
    const res = await call("/api/firmware/v0.2.0/SHA256SUMS");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "too_large" });
  });

  it("serves an asset at the cap, with nosniff and an exact Content-Type", async () => {
    stubCache();
    vi.stubGlobal("fetch", async () => unsizedBody(1024));
    const res = await call("/api/firmware/v0.2.0/SHA256SUMS");
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(1024);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("adds nosniff to error responses too", async () => {
    stubCache();
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("skips a release whose manifest lookup throws instead of failing the list", async () => {
    stubCache();
    const feed = `<feed>${["v0.3.0", "v0.2.0"]
      .map(
        (tag) => `<entry><id>tag:github.com,2008:Repository/1/${tag}</id><updated>2026-11-23T05:10:23Z</updated><link rel="alternate" type="text/html" href="https://github.com/mewisme/esp32-security-key/releases/tag/${tag}"/><title>${tag}</title><content type="html"></content></entry>`,
      )
      .join("")}</feed>`;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("releases.atom")) return new Response(feed, { status: 200 });
      if (init?.method === "HEAD" && url.includes("/v0.3.0/")) throw new Error("network");
      return new Response("", { status: 200 });
    });
    const res = await call("/api/releases");
    expect(res.status).toBe(200);
    const list = (await res.json()) as { tag: string }[];
    expect(list.map((r) => r.tag)).toEqual(["v0.2.0"]);
  });
});
