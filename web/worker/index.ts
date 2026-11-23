// MultiKeys web installer Worker: static assets (handled by the platform) plus a read-only proxy for GitHub
// release metadata and firmware assets, which GitHub serves without CORS headers. No secrets, no tokens; the only
// user-controlled inputs are the two path segments validated in routes.ts.
import { MAX_ASSET_BYTES, REPOSITORY, contentTypeFor, parseFirmwareRoute, parseReleasesAtom } from "./routes";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function error(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), { status, headers: JSON_HEADERS });
}

async function cached(request: Request, ctx: ExecutionContext, produce: () => Promise<Response>): Promise<Response> {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
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
      const res = await fetch(`https://github.com/${REPOSITORY}/releases/download/${r.tag}/firmware-manifest.json`, {
        method: "HEAD",
        redirect: "follow",
        headers: { "User-Agent": "multikeys-web" },
      });
      return res.status === 200 ? r : null;
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
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_ASSET_BYTES) return error(502, "too_large");
  return new Response(body, {
    headers: {
      "Content-Type": contentTypeFor(asset),
      // Tagged release assets never change: the release workflow refuses to touch an existing release.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export default {
  async fetch(request, _env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return error(404, "not_found");
    const isReleases = url.pathname === "/api/releases";
    const isFirmware = url.pathname.startsWith("/api/firmware/");
    if (!isReleases && !isFirmware) return error(404, "not_found");
    if (request.method !== "GET" && request.method !== "HEAD") return error(405, "method_not_allowed");
    if (isReleases) return cached(request, ctx, releases);
    const route = parseFirmwareRoute(url.pathname);
    if (!route) return error(400, "bad_request");
    return cached(request, ctx, () => firmware(route.tag, route.asset));
  },
} satisfies ExportedHandler;
