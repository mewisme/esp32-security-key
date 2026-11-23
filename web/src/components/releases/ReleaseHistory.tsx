import { ReleaseBadges } from "@/components/installer/FirmwareStage";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { useI18n } from "@/i18n/context";
import type { Catalog, CatalogRelease } from "@/lib/firmware/catalog";
import { REPO_URL } from "@/lib/status";
import { formatDate } from "./format-date";
import { NotesLink } from "./NotesLink";

/** Compact list of the other releases in the catalog; each one opens its firmware in the download selector. */
export function ReleaseHistory({
  catalog,
  hero,
  onShowFirmware,
}: {
  catalog: Catalog;
  hero: CatalogRelease;
  onShowFirmware: (tag: string) => void;
}) {
  const { t, locale } = useI18n();
  const latestStableTag = catalog.releases.find((r) => !r.prerelease)?.tag;
  const others = catalog.releases.filter((r) => r.tag !== hero.tag);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="release-history-title">
      <h2 id="release-history-title" className="text-xl font-semibold">
        {t.releases.history}
      </h2>
      {others.length > 0 && (
        <ItemGroup className="gap-2">
          {others.map((r) => (
            <Item key={r.tag} variant="outline" size="sm" id={`release-${r.tag}`}>
              <ItemContent>
                <ItemTitle className="flex-wrap">
                  <span className="tabular-nums">v{r.manifest.version}</span>
                  <ReleaseBadges release={r} latestStable={r.tag === latestStableTag} />
                  <span className="text-xs font-normal text-muted-foreground">{r.publishedAt ? formatDate(r.publishedAt, locale) : t.releases.unpublished}</span>
                </ItemTitle>
              </ItemContent>
              <ItemActions className="text-sm text-muted-foreground">
                {r.notesUrl && <NotesLink url={r.notesUrl} />}
                <Button type="button" variant="outline" size="sm" aria-label={t.releases.showFirmwareFor(r.tag)} onClick={() => onShowFirmware(r.tag)}>
                  {t.releases.showFirmware}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      <p className="text-sm text-muted-foreground">
        {t.releases.scope(
          <a className="underline underline-offset-4 transition-colors hover:text-primary" href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer">
            {t.releases.githubReleases}
          </a>,
        )}
      </p>
    </section>
  );
}
