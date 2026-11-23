import { ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalog } from "@/hooks/useCatalog";
import { formatBytes } from "@/lib/format";
import { REPO_URL } from "@/lib/status";

export function ReleasesPage() {
  const catalog = useCatalog();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-semibold">Releases</h1>
      <p className="text-muted-foreground">
        Firmware published on{" "}
        <a className="underline underline-offset-4" href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
          GitHub Releases
        </a>
        . Releases before v0.2.0 contain host tools only.
      </p>
      {catalog.status === "loading" && <Skeleton className="h-32 w-full" />}
      {catalog.status === "error" && (
        <Alert variant="destructive">
          <AlertTitle>The release list couldn't be loaded</AlertTitle>
          <AlertDescription>{catalog.message}</AlertDescription>
        </Alert>
      )}
      {catalog.status === "ready" && catalog.catalog.releases.length === 0 && <p>No firmware release published yet.</p>}
      {catalog.status === "ready" &&
        catalog.catalog.releases.map((r) => (
          <Card key={r.tag}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {r.name} {r.prerelease && <Badge variant="secondary">Pre-release</Badge>}
              </CardTitle>
              <CardDescription>
                {r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : "unpublished"} · source {r.manifest.source_commit.slice(0, 12)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {r.manifest.builds.map((b) => (
                <p key={b.id}>
                  {b.title} · {b.board} · {formatBytes(b.package.size)}
                </p>
              ))}
              {r.notesUrl && (
                <a className="inline-flex items-center gap-1 text-sm underline underline-offset-4" href={r.notesUrl} target="_blank" rel="noreferrer">
                  Release notes <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </CardContent>
          </Card>
        ))}
      {catalog.status === "ready" && catalog.catalog.rejected.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="text-sm text-muted-foreground underline underline-offset-4">Technical details</CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
              {`${catalog.catalog.rejected.length} release(s) skipped because their manifest failed validation:\n`}
              {catalog.catalog.rejected.map((x) => `${x.tag}: ${x.detail}`).join("\n")}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
