import { CatalogError } from "@/components/releases/CatalogError";
import { Page } from "@/components/layout/Page";
import { Frame, FrameHeader, FramePanel } from "@/components/reui/frame";
import { ReleaseFrame } from "@/components/releases/ReleaseFrame";
import { ReleaseTimeline } from "@/components/releases/ReleaseTimeline";
import { useReleaseCatalog } from "@/components/releases/useReleaseCatalog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/context";
import { REPO_URL } from "@/lib/status";

export function ReleasesPage() {
  const { catalog, reload } = useReleaseCatalog();
  const { t } = useI18n();
  return (
    <Page width="wide">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{t.releases.title}</h1>
        <p className="text-muted-foreground">
          {t.releases.intro(
            <a className="underline underline-offset-4" href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer">
              {t.releases.githubReleases}
            </a>,
          )}
        </p>
      </header>
      {catalog.status === "loading" && (
        <div className="flex flex-col gap-6" role="status" aria-label={t.common.loadingReleases}>
          <Frame spacing="default">
            <FrameHeader>
              <Skeleton className="h-5 w-48" />
            </FrameHeader>
            <FramePanel>
              <Skeleton className="h-16 w-full" />
            </FramePanel>
          </Frame>
        </div>
      )}
      {catalog.status === "error" && <CatalogError message={catalog.message} onRetry={reload} />}
      {catalog.status === "ready" && catalog.catalog.releases.length === 0 && <p className="text-muted-foreground">{t.common.noFirmwareRelease}</p>}
      {catalog.status === "ready" && catalog.catalog.releases.length >= 2 && <ReleaseTimeline releases={catalog.catalog.releases} />}
      {catalog.status === "ready" && (
        <div className="flex flex-col gap-6">
          {catalog.catalog.releases.map((r) => (
            <ReleaseFrame key={r.tag} release={r} />
          ))}
        </div>
      )}
      {catalog.status === "ready" && catalog.catalog.rejected.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="text-sm text-muted-foreground underline underline-offset-4">{t.common.technicalDetails}</CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
              {`${t.releases.skipped(catalog.catalog.rejected.length)}\n`}
              <span lang="en">{catalog.catalog.rejected.map((x) => `${x.tag}: ${x.detail}`).join("\n")}</span>
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Page>
  );
}
