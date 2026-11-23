import { ChevronDown, ExternalLink, Lock } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import type { CatalogState } from "@/hooks/useInstaller";
import type { CatalogRelease } from "@/lib/firmware/catalog";
import type { Build } from "@/lib/firmware/types";
import { formatBytes } from "@/lib/format";
import { REPO_URL } from "@/lib/status";

export function FirmwareStep(props: {
  catalog: CatalogState;
  defaultRelease: CatalogRelease | null;
  onReload: () => void;
  onSelect: (release: CatalogRelease, build: Build) => void;
}) {
  const { catalog } = props;
  const [tag, setTag] = useState<string | null>(null);
  if (catalog.status === "loading") return <Skeleton className="h-40 w-full" aria-label="Loading releases" />;
  if (catalog.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>The firmware list couldn't be loaded</AlertTitle>
        <AlertDescription>
          <p>Check your internet connection.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={props.onReload}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const releases = catalog.catalog.releases;
  const selected = releases.find((r) => r.tag === (tag ?? props.defaultRelease?.tag)) ?? null;
  const build = selected?.manifest.builds.find((b) => b.image === "fido") ?? null;
  return (
    <div className="space-y-5">
      {releases.length === 0 ? (
        <Alert>
          <AlertTitle>No firmware release published yet</AlertTitle>
          <AlertDescription>
            Prebuilt firmware isn't available yet. Use the developer method described in the{" "}
            <a className="underline underline-offset-4" href={`${REPO_URL}#install-multikeys`} target="_blank" rel="noreferrer">
              README
            </a>
            .
          </AlertDescription>
        </Alert>
      ) : (
        <fieldset>
          <legend className="mb-2 font-medium">Firmware</legend>
          <RadioGroup value={selected?.tag ?? ""} onValueChange={setTag} className="gap-2">
            {releases.map((r) => {
              const b = r.manifest.builds.find((x) => x.image === "fido");
              return (
                <Label
                  key={r.tag}
                  htmlFor={`rel-${r.tag}`}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal transition-colors hover:bg-accent has-data-[state=checked]:border-primary"
                >
                  <RadioGroupItem id={`rel-${r.tag}`} value={r.tag} className="mt-1" />
                  <span className="grid gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {b?.title ?? "MultiKeys"} <Badge variant={r.prerelease ? "secondary" : "default"}>{r.prerelease ? "Pre-release" : "Stable"}</Badge>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Version {r.manifest.version}
                      {b ? ` · ${formatBytes(b.package.size)} download` : ""}
                      {r.publishedAt ? ` · ${new Date(r.publishedAt).toLocaleDateString()}` : ""}
                    </span>
                    {r.notesUrl && (
                      <a className="inline-flex items-center gap-1 text-sm underline underline-offset-4" href={r.notesUrl} target="_blank" rel="noreferrer">
                        Release notes <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
        </fieldset>
      )}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1">
            Advanced <ChevronDown className="size-4" aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card aria-disabled className="mt-2 opacity-70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="size-4" aria-hidden /> MultiKeys OpenPGP — Development Firmware
              </CardTitle>
              <CardDescription>
                Not available in the web installer. Build from source with the developer script (
                <a className="underline underline-offset-4" href={`${REPO_URL}/blob/main/docs/FLASHING_ADVANCED.md`} target="_blank" rel="noreferrer">
                  instructions
                </a>
                ).
              </CardDescription>
            </CardHeader>
          </Card>
        </CollapsibleContent>
      </Collapsible>
      <Button disabled={!selected || !build} onClick={() => selected && build && props.onSelect(selected, build)}>
        Continue
      </Button>
    </div>
  );
}
