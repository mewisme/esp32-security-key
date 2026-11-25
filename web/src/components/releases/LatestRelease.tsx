import { Link } from "react-router";
import { ReleaseBadges } from "@/components/installer/FirmwareStage";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";
import type { Catalog, CatalogRelease } from "@/lib/firmware/catalog";
import { allSizesIn, imagesIn, megabytes } from "@/lib/firmware/release-select";
import { formatDate } from "./format-date";
import { NotesLink } from "./NotesLink";

/** The newest stable release (else the newest pre-release): facts from its manifest, and and a link to the Install page. */
export function LatestRelease({ catalog, release: r }: { catalog: Catalog; release: CatalogRelease }) {
  const { t, locale } = useI18n();
  const latestStable = catalog.releases.find((x) => !x.prerelease);
  const images = imagesIn(r)
    .map((i) => t.releases.imageNames[i])
    .join(" / ");
  const sizes = allSizesIn(r)
    .map((s) => megabytes(s))
    .join(" / ");
  const chip = r.manifest.builds[0]?.chip ?? "";
  return (
    <Frame spacing="default">
      <FramePanel className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{r.name}</h2>
            <ReleaseBadges release={r} latestStable={latestStable?.tag === r.tag} />
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{r.publishedAt ? formatDate(r.publishedAt, locale) : t.releases.unpublished}</span>
            <span aria-hidden>·</span>
            <span>
              {t.releases.sourceCommit} <code className="font-mono">{r.manifest.source_commit.slice(0, 12)}</code>
            </span>
            {r.notesUrl && (
              <>
                <span aria-hidden>·</span>
                <NotesLink url={r.notesUrl} />
              </>
            )}
          </p>
          <p className="text-sm">{t.releases.facts(images, `${sizes} MB`, chip)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/install">{t.releases.installCta}</Link>
          </Button>
        </div>
      </FramePanel>
    </Frame>
  );
}
