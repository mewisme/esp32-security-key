// Says whether the image running on a key is one a release published. The firmware reports the SHA-256 of its app image as
// flashed (MKAUTH INS 07); every manifest build lists the same hash as `images[role=app].sha256`. A match proves the key
// runs exactly that published image. No match means a local, modified or unlisted build: it is not proof of tampering.
import type { CatalogRelease } from "../firmware/catalog";

export interface PublishedMatch {
  tag: string;
  version: string;
  buildId: string;
  profileId: string;
  flashSize: string;
  title: string;
}

export function matchPublished(imageSha256: string, releases: readonly CatalogRelease[]): PublishedMatch[] {
  const want = imageSha256.toLowerCase();
  const out: PublishedMatch[] = [];
  for (const r of releases) {
    for (const b of r.manifest.builds) {
      if (b.images.some((i) => i.role === "app" && i.sha256.toLowerCase() === want)) {
        out.push({ tag: r.tag, version: b.version, buildId: b.id, profileId: b.profile_id, flashSize: b.flash_size, title: b.title });
      }
    }
  }
  return out;
}
