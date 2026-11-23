// Pure request parsing for the Worker (unit-tested in tests/unit/worker-routes.test.ts).
// The Worker only ever proxies two validated path segments to fixed GitHub URLs.

export const REPOSITORY = "mewisme/esp32-security-key";
export const MAX_ASSET_BYTES = 16 * 1024 * 1024;

export const TAG_RE = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
export const ASSET_RE =
  /^(firmware-manifest\.json|SHA256SUMS|multikey-firmware-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-esp32s3-n16r8-(fido|openpgp)-dev\.zip)$/;

export type FirmwareRoute = { tag: string; asset: string };

/** Validates an asset name; for real tags the version inside a zip name must equal the tag. */
export function isAllowedAsset(tag: string, asset: string): boolean {
  const m = ASSET_RE.exec(asset);
  if (!m) return false;
  const version = m[2];
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

export function contentTypeFor(asset: string): string {
  if (asset.endsWith(".json")) return "application/json";
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

/** GitHub `GET /repos/:repo/releases` JSON -> published releases that carry a firmware manifest. */
export function filterReleases(json: unknown): ReleaseSummary[] {
  if (!Array.isArray(json)) return [];
  const out: ReleaseSummary[] = [];
  for (const r of json as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || r.draft !== false) continue;
    const tag = r.tag_name;
    if (typeof tag !== "string" || !TAG_RE.test(tag)) continue;
    const assets = Array.isArray(r.assets) ? (r.assets as Record<string, unknown>[]) : [];
    if (!assets.some((a) => a && a.name === "firmware-manifest.json")) continue;
    out.push({
      tag,
      name: typeof r.name === "string" && r.name ? r.name : tag,
      prerelease: r.prerelease === true,
      published_at: typeof r.published_at === "string" ? r.published_at : null,
      html_url: typeof r.html_url === "string" ? r.html_url : null,
    });
  }
  return out;
}
