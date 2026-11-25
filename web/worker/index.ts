// MultiKeys web installer Worker: static assets (handled by the platform) plus a read-only proxy for GitHub
// release metadata and firmware assets, which GitHub serves without CORS headers. No secrets, no tokens; the only
// user-controlled inputs are the two path segments validated in routes.ts.
import { MAX_ASSET_BYTES, REPOSITORY, cacheKeyUrl, contentTypeFor, parseFirmwareRoute, parseReleasesAtom, readCapped } from "./routes";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function error(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), { status, headers: JSON_HEADERS });
}

async function cached(keyUrl: string, ctx: ExecutionContext, produce: () => Promise<Response>): Promise<Response> {
  const cache = caches.default;
  const key = new Request(keyUrl, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await produce();
  if (res.status === 200) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function releases(): Promise<Response> {
  const upstream = await fetch(`https://github.com/${REPOSITORY}/releases.atom`, {
    headers: { "User-Agent": "multikeys-web", Accept: "application/atom+xml" },
  });
  if (upstream.status !== 200) return error(502, "upstream");
  // The feed lists the newest releases; keep those that actually carry a firmware manifest (v0.1.0 has none).
  const candidates = parseReleasesAtom(await upstream.text()).slice(0, 10);
  const withManifest = await Promise.all(
    candidates.map(async (r) => {
      // One failed lookup must not fail the whole list: that release is skipped.
      try {
        const res = await fetch(`https://github.com/${REPOSITORY}/releases/download/${r.tag}/firmware-manifest.json`, {
          method: "HEAD",
          redirect: "follow",
          headers: { "User-Agent": "multikeys-web" },
        });
        return res.status === 200 ? r : null;
      } catch {
        return null;
      }
    }),
  );
  return new Response(JSON.stringify(withManifest.filter((r) => r !== null)), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}

async function firmware(tag: string, asset: string): Promise<Response> {
  const upstream = await fetch(`https://github.com/${REPOSITORY}/releases/download/${tag}/${asset}`, {
    redirect: "follow",
    headers: { "User-Agent": "multikeys-web" },
  });
  if (upstream.status === 404) return error(404, "not_found");
  if (upstream.status !== 200) return error(502, "upstream");
  const length = Number(upstream.headers.get("Content-Length") ?? "0");
  if (length > MAX_ASSET_BYTES) return error(502, "too_large");
  // Content-Length may be absent or wrong: count the bytes as they arrive and stop at the cap.
  const body = await readCapped(upstream.body, MAX_ASSET_BYTES);
  if (body === null) return error(502, "too_large");
  return new Response(body, {
    headers: {
      "Content-Type": contentTypeFor(asset),
      // Tagged release assets never change: the release workflow refuses to touch an existing release.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/** Every response, cached or not, tells the browser not to second-guess its Content-Type. */
function hardened(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set("X-Content-Type-Options", "nosniff");
  return out;
}

async function handle(request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return error(404, "not_found");
  const isReleases = url.pathname === "/api/releases";
  const isFirmware = url.pathname.startsWith("/api/firmware/");
  if (!isReleases && !isFirmware) return error(404, "not_found");
  if (request.method !== "GET" && request.method !== "HEAD") return error(405, "method_not_allowed");
  if (isReleases) return cached(cacheKeyUrl(request.url, null), ctx, releases);
  const found = parseFirmwareRoute(url.pathname);
  if (!found) return error(400, "bad_request");
  return cached(cacheKeyUrl(request.url, found), ctx, () => firmware(found.tag, found.asset));
}

export default {
  async fetch(request, _env, ctx): Promise<Response> {
    return hardened(await handle(request, ctx));
  },
} satisfies ExportedHandler;
