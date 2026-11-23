import { FirmwareError } from "../errors/firmware-error";
import { validateManifest } from "./manifest";
import type { ReleaseKey } from "./release-keys";
import { type Authentication, authenticateManifest } from "./signature";
import type { Build, Manifest } from "./types";
import { compareSemver } from "./version";

export interface CatalogRelease {
  tag: string;
  name: string;
  prerelease: boolean;
  publishedAt: string | null;
  notesUrl: string | null;
  manifest: Manifest;
  /** Whether the manifest carries a valid signature by a key built into the site; releases from before signing are `unsigned`. */
  authentication: Authentication;
}

export interface Catalog {
  releases: CatalogRelease[];
  /** Releases whose manifest failed validation; shown only under "Technical details". */
  rejected: { tag: string; detail: string }[];
}

interface ReleaseSummary {
  tag: string;
  name: string;
  prerelease: boolean;
  published_at: string | null;
  html_url: string | null;
}

export async function fetchCatalog(
  fetchImpl: typeof fetch = fetch,
  /** Trust anchors; the built-in ones unless a test supplies its own. */
  auth: { keys?: readonly ReleaseKey[]; requiredFrom?: string | null } = {},
): Promise<Catalog> {
  let list: ReleaseSummary[];
  try {
    const res = await fetchImpl("/api/releases");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = (await res.json()) as ReleaseSummary[];
    if (!Array.isArray(list)) throw new Error("not a list");
  } catch (e) {
    throw new FirmwareError("firmware-unavailable", `release list: ${e instanceof Error ? e.message : String(e)}`);
  }
  const rejected: Catalog["rejected"] = [];
  const results = await Promise.all(
    list.map(async (r): Promise<CatalogRelease | null> => {
      try {
        const base = `/api/firmware/${encodeURIComponent(r.tag)}`;
        const res = await fetchImpl(`${base}/firmware-manifest.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        // The signature is judged on the manifest's exact bytes before anything in it is trusted. Only a 404 means
        // "this release has no signature"; any other failure to fetch it refuses the release instead of downgrading it.
        const sigRes = await fetchImpl(`${base}/firmware-manifest.json.sig`);
        if (!sigRes.ok && sigRes.status !== 404) throw new Error(`signature: HTTP ${sigRes.status}`);
        const signature = sigRes.ok ? new Uint8Array(await sigRes.arrayBuffer()) : null;
        const authentication = await authenticateManifest({ tag: r.tag, manifest: bytes, signature }, auth.keys, auth.requiredFrom);
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new FirmwareError("manifest-invalid", "firmware-manifest.json is not JSON");
        }
        const manifest = validateManifest(parsed, r.tag);
        return { tag: r.tag, name: r.name, prerelease: r.prerelease, publishedAt: r.published_at, notesUrl: r.html_url, manifest, authentication };
      } catch (e) {
        rejected.push({ tag: r.tag, detail: e instanceof Error ? e.message : String(e) });
        return null;
      }
    }),
  );
  const releases = results
    .filter((r): r is CatalogRelease => r !== null)
    .sort((a, b) => compareSemver(b.manifest.version, a.manifest.version) ?? 0);
  return { releases, rejected };
}

/** Newest stable release, else newest pre-release. */
export function defaultRelease(c: Catalog): CatalogRelease | null {
  return c.releases.find((r) => !r.prerelease) ?? c.releases[0] ?? null;
}

/** Builds as people read them: fido before openpgp, smallest flash first ("4 / 8 / 16 MB"). */
export function buildsBySize(builds: readonly Build[]): Build[] {
  return [...builds].sort((a, b) => a.image.localeCompare(b.image) || parseInt(a.flash_size, 10) - parseInt(b.flash_size, 10));
}
