// Which published build an application-only update offers: the newest stable release that declares `update.app_only`
// for the installed image family, else the newest one at all (which the decision then reports as release-unsupported).
import type { Catalog, CatalogRelease } from "../firmware/catalog";
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
