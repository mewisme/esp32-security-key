// Which published build an application-only update offers: the newest stable release that declares `update.app_only`
// for the installed image family, else the newest one at all (which the decision then reports as release-unsupported).
import type { Catalog, CatalogRelease } from "../firmware/catalog";
import { compareSemver } from "../firmware/version";
import type { Build } from "../firmware/types";

export interface UpdateTarget {
  release: CatalogRelease;
  build: Build;
}

/** `flashSize` ("16MB") narrows the build; null picks the first build of the family (a preview only). */
export function findUpdateTarget(catalog: Catalog, image: Build["image"], flashSize: string | null): UpdateTarget | null {
  const pick = (r: CatalogRelease): Build | undefined =>
    r.manifest.builds.find((b) => b.image === image && (flashSize === null || b.flash_size === flashSize));
  const offered = catalog.releases.flatMap((release): UpdateTarget[] => {
    const build = pick(release);
    return build ? [{ release, build }] : [];
  });
  const capable = offered.filter((t) => t.build.update.app_only === true);
  return capable.find((t) => !t.release.prerelease) ?? capable[0] ?? offered.find((t) => !t.release.prerelease) ?? offered[0] ?? null;
}

const buildOf = (r: CatalogRelease, image: Build["image"], flashSize: string | null): Build | undefined =>
  r.manifest.builds.find((b) => b.image === image && (flashSize === null || b.flash_size === flashSize));

/**
 * The releases the person may pick, newest first: every release with a build for the family that is strictly newer than
 * the installed version. With no readable installed version nothing can be ruled out, so all of them are listed.
 */
export function listUpdateTargets(catalog: Catalog, image: Build["image"], flashSize: string | null, installedVersion: string | null): UpdateTarget[] {
  return catalog.releases.flatMap((release): UpdateTarget[] => {
    const build = buildOf(release, image, flashSize);
    if (!build) return [];
    const c = installedVersion === null ? null : compareSemver(installedVersion, build.version);
    return installedVersion !== null && c !== null && c >= 0 ? [] : [{ release, build }];
  });
}

/** The one offered by default: the release right after the installed one (the oldest listed), never silently the latest. */
export function defaultUpdateTarget(offers: UpdateTarget[], installedVersion: string | null, latest: UpdateTarget | null): UpdateTarget | null {
  if (installedVersion === null) return latest;
  return offers.at(-1) ?? null;
}

export function targetByTag(catalog: Catalog, tag: string, image: Build["image"], flashSize: string | null): UpdateTarget | null {
  const release = catalog.releases.find((r) => r.tag === tag);
  const build = release && buildOf(release, image, flashSize);
  return release && build ? { release, build } : null;
}
