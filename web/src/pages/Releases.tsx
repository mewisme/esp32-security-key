import { CatalogError } from "@/components/releases/CatalogError";
import { Page } from "@/components/layout/Page";
import { Frame, FrameHeader, FramePanel } from "@/components/reui/frame";
import { ReleaseFrame } from "@/components/releases/ReleaseFrame";
import { ReleaseTimeline } from "@/components/releases/ReleaseTimeline";
import { useReleaseCatalog } from "@/components/releases/useReleaseCatalog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { REPO_URL } from "@/lib/status";

export function ReleasesPage() {
  const { catalog, reload } = useReleaseCatalog();
  return (
    <Page width="wide">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Releases</h1>
        <p className="text-muted-foreground">
          Firmware published on{" "}
          <a className="underline underline-offset-4" href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer">
            GitHub Releases
          </a>
          . Releases before v0.2.0 contain host tools only.
        </p>
      </header>
      {catalog.status === "loading" && (
        <div className="flex flex-col gap-6" role="status" aria-label="Loading releases">
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
      {catalog.status === "ready" && catalog.catalog.releases.length === 0 && <p className="text-muted-foreground">No firmware release yet</p>}
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
          <CollapsibleTrigger className="text-sm text-muted-foreground underline underline-offset-4">Technical details</CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
              {`${catalog.catalog.rejected.length} release(s) skipped because their manifest failed validation:\n`}
              {catalog.catalog.rejected.map((x) => `${x.tag}: ${x.detail}`).join("\n")}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Page>
  );
}
