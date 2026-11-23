import { useState } from "react";
import { Page } from "@/components/layout/Page";
import { PageHeader } from "@/components/layout/PageHeader";
import { AsyncState } from "@/components/common/AsyncState";
import { FirmwareDownloads } from "@/components/releases/FirmwareDownloads";
import { LatestRelease } from "@/components/releases/LatestRelease";
import { ReleaseHistory } from "@/components/releases/ReleaseHistory";
import { useReleaseCatalog } from "@/components/releases/useReleaseCatalog";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useChangedSinceMount } from "@/hooks/useChangedSinceMount";
import { useI18n } from "@/i18n/context";
import { type Catalog, defaultRelease } from "@/lib/firmware/catalog";
import { type DownloadChoice, initialChoice } from "@/lib/firmware/release-select";
import { REPO_URL } from "@/lib/status";
import { cn } from "cn";

function ReleasesReady({ catalog, className }: { catalog: Catalog; className?: string }) {
  const { t } = useI18n();
  const hero = defaultRelease(catalog);
  const [choice, setChoice] = useState<DownloadChoice | null>(() => initialChoice(catalog));
  const showFirmware = (tag: string) => {
    setChoice((c) => (c ? { ...c, tag } : c));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("downloads")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };
  return (
    <div className={cn("flex flex-col gap-10", className)}>
      {!hero || !choice ? (
        <p className="text-muted-foreground">{t.common.noFirmwareRelease}</p>
      ) : (
        <>
          <LatestRelease catalog={catalog} release={hero} />
          <FirmwareDownloads catalog={catalog} choice={choice} onChoice={setChoice} />
          <ReleaseHistory catalog={catalog} hero={hero} onShowFirmware={showFirmware} />
        </>
      )}
      {catalog.rejected.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
            {t.common.technicalDetails}
          </CollapsibleTrigger>
          <CollapsibleContent className="collapse-content pt-2">
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
              {`${t.releases.skipped(catalog.rejected.length)}\n`}
              <span lang="en">{catalog.rejected.map((x) => `${x.tag}: ${x.detail}`).join("\n")}</span>
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function ReleasesPage() {
  const { catalog, reload } = useReleaseCatalog();
  const { t } = useI18n();
  // The answer replaces the skeleton with a reveal; a catalog that is already there rides on the page.
  const reveal = useChangedSinceMount(catalog.status) ? "enter-reveal" : undefined;
  return (
    <Page width="wide">
      <PageHeader
        title={t.releases.title}
        description={t.releases.intro(
          <a className="underline underline-offset-4 transition-colors hover:text-primary" href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer">
            {t.releases.githubReleases}
          </a>,
        )}
      />
      {catalog.status === "loading" && (
        <div className="flex flex-col gap-10" role="status" aria-label={t.common.loadingReleases}>
          <Frame spacing="default">
            <FramePanel className="flex flex-col gap-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-8 w-56" />
            </FramePanel>
          </Frame>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16 w-full" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      )}
      {catalog.status === "error" && (
        <div className={reveal}>
          <AsyncState state="error" title={t.releases.loadFailed} message={catalog.message} retryLabel={t.common.retry} onRetry={reload} />
        </div>
      )}
      {catalog.status === "ready" && <ReleasesReady catalog={catalog.catalog} className={reveal} />}
    </Page>
  );
}
