// Pure request parsing for the Worker (unit-tested in tests/unit/worker-routes.test.ts).
// The Worker only ever proxies two validated path segments to fixed GitHub URLs.

export const REPOSITORY = "mewisme/esp32-security-key";
export const MAX_ASSET_BYTES = 16 * 1024 * 1024;

export const TAG_RE = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
// `n16r8` is accepted only so the v0.2.0 assets (schema 1) stay downloadable; new releases name the flash size.
export const ASSET_RE =
  /^(firmware-manifest\.json|firmware-manifest\.json\.sig|SHA256SUMS|multikey-firmware-v(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-esp32s3-(?<hw>n16r8|4mb|8mb|16mb)-(?<image>fido|openpgp)-dev\.zip)$/;

export type FirmwareRoute = { tag: string; asset: string };

/** Validates an asset name; for real tags the version inside a zip name must equal the tag. */
export function isAllowedAsset(tag: string, asset: string): boolean {
  const m = ASSET_RE.exec(asset);
  if (!m) return false;
  const version = m.groups?.version;
  return version === undefined || tag === "local" || version === tag.slice(1);
}

/** `/api/firmware/:tag/:asset` -> route, or null when the path is not exactly that shape with allowed values. */
export function parseFirmwareRoute(pathname: string): FirmwareRoute | null {
  const parts = pathname.split("/");
  // ["", "api", "firmware", tag, asset]
  if (parts.length !== 5 || parts[0] !== "" || parts[1] !== "api" || parts[2] !== "firmware") return null;
  const tag = parts[3] ?? "";
  const asset = parts[4] ?? "";
  if (!TAG_RE.test(tag) || !isAllowedAsset(tag, asset)) return null;
  return { tag, asset };
}

/**
 * The cache key for a response: the origin plus the validated path, never the query string or fragment, so
 * `/api/releases?x=1` and `/api/firmware/v1.2.3/SHA256SUMS?x=2` cannot each create another cache entry for the same
 * content. `route` is the parsed firmware route, or null for `/api/releases`.
 */
export function cacheKeyUrl(requestUrl: string, route: FirmwareRoute | null): string {
  const { origin } = new URL(requestUrl);
  return route ? `${origin}/api/firmware/${route.tag}/${route.asset}` : `${origin}/api/releases`;
}

export function contentTypeFor(asset: string): string {
  if (asset.endsWith(".json") || asset.endsWith(".sig")) return "application/json";
  if (asset.endsWith(".zip")) return "application/zip";
  return "text/plain; charset=utf-8";
}

export type ReleaseSummary = {
  tag: string;
  name: string;
  prerelease: boolean;
  published_at: string | null;
  html_url: string | null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/**
 * GitHub's releases Atom feed (`/releases.atom`) -> published releases with a valid tag, newest first. The feed is used
 * instead of the REST API because unauthenticated API calls from Workers' shared egress IPs hit GitHub's rate limit
 * (observed as HTTP 403/502 on staging). Drafts never appear in the feed; the release workflow marks exactly the versions
 * with a `-suffix` as pre-releases, so that is derived from the tag. Callers still check that the release has a manifest.
 */
export function parseReleasesAtom(xml: string): ReleaseSummary[] {
  const out: ReleaseSummary[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1] ?? "";
    const href = /<link[^>]*rel="alternate"[^>]*href="(https:\/\/github\.com\/[^"]+\/releases\/tag\/([^"]+))"/.exec(entry);
    if (!href) continue;
    let tag: string;
    try {
      tag = decodeURIComponent(href[2] ?? "");
    } catch {
      continue;
    }
    if (!TAG_RE.test(tag)) continue;
    const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1]?.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_s, e: string) => ENTITIES[e] ?? "");
    const updated = /<updated>([^<]+)<\/updated>/.exec(entry)?.[1] ?? null;
    out.push({ tag, name: title || tag, prerelease: tag.includes("-"), published_at: updated, html_url: href[1] ?? null });
  }
  return out;
}

/** Reads a body into one buffer, giving up (null) the moment more than `cap` bytes have arrived. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}
