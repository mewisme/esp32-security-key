import { FirmwareError } from "../errors/firmware-error";
import { validateManifest } from "./manifest";
import type { Manifest } from "./types";
import { compareSemver } from "./version";

export interface CatalogRelease {
  tag: string;
  name: string;
  prerelease: boolean;
  publishedAt: string | null;
  notesUrl: string | null;
  manifest: Manifest;
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

export async function fetchCatalog(fetchImpl: typeof fetch = fetch): Promise<Catalog> {
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
        const res = await fetchImpl(`/api/firmware/${encodeURIComponent(r.tag)}/firmware-manifest.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const manifest = validateManifest(await res.json(), r.tag);
        return { tag: r.tag, name: r.name, prerelease: r.prerelease, publishedAt: r.published_at, notesUrl: r.html_url, manifest };
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
