import { buildsBySize, defaultRelease, type Catalog, type CatalogRelease } from "./catalog";
import type { Build } from "./types";

export type Image = Build["image"];

/** What the download selector shows: one release, one firmware type, one flash size (`Build.flash_size`, e.g. "16MB"). */
export interface DownloadChoice {
  tag: string;
  image: Image;
  flashSize: string;
}

const IMAGE_ORDER: Image[] = ["fido", "openpgp"];

export const megabytes = (flashSize: string): number => parseInt(flashSize, 10);

function sortSizes(sizes: Iterable<string>): string[] {
  return [...new Set(sizes)].sort((a, b) => megabytes(a) - megabytes(b));
}

/** Firmware types a release carries, fido first. */
export function imagesIn(r: CatalogRelease): Image[] {
  return IMAGE_ORDER.filter((i) => r.manifest.builds.some((b) => b.image === i));
}

/** Firmware types in any release of the catalog, fido first. */
export function imagesInCatalog(c: Catalog): Image[] {
  return IMAGE_ORDER.filter((i) => c.releases.some((r) => r.manifest.builds.some((b) => b.image === i)));
}

/** Flash sizes of one release's builds of `image`, smallest first. */
export function sizesIn(r: CatalogRelease, image: Image): string[] {
  return sortSizes(r.manifest.builds.filter((b) => b.image === image).map((b) => b.flash_size));
}

/** Flash sizes that any release of the catalog offers for `image`, smallest first. */
export function sizesInCatalog(c: Catalog, image: Image): string[] {
  return sortSizes(c.releases.flatMap((r) => sizesIn(r, image)));
}

/** Flash sizes of every build of a release, smallest first. */
export function allSizesIn(r: CatalogRelease): string[] {
  return sortSizes(r.manifest.builds.map((b) => b.flash_size));
}

export function findBuild(r: CatalogRelease, image: Image, flashSize: string): Build | null {
  return buildsBySize(r.manifest.builds).find((b) => b.image === image && b.flash_size === flashSize) ?? null;
}

/** Newest release (catalog order) other than `exceptTag` that has the combination; a stable one wins over a pre-release. */
export function releaseWith(c: Catalog, image: Image, flashSize: string, exceptTag?: string): CatalogRelease | null {
  const have = c.releases.filter((r) => r.tag !== exceptTag && findBuild(r, image, flashSize) !== null);
  return have.find((r) => !r.prerelease) ?? have[0] ?? null;
}

/** The newest stable release (else the newest pre-release), fido, 16 MB when it has it. */
export function initialChoice(c: Catalog): DownloadChoice | null {
  const r = defaultRelease(c);
  if (!r) return null;
  const images = imagesIn(r);
  const image = images.includes("fido") ? "fido" : images[0];
  if (!image) return null;
  const sizes = sizesIn(r, image);
  const flashSize = sizes.includes("16MB") ? "16MB" : (sizes[sizes.length - 1] ?? "16MB");
  return { tag: r.tag, image, flashSize };
}

/** The proxied asset URL; the name is the exact one in the manifest. */
export function downloadUrl(tag: string, b: Build): string {
  return `/api/firmware/${encodeURIComponent(tag)}/${encodeURIComponent(b.package.name)}`;
}
