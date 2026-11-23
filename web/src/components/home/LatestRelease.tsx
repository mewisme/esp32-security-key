import { Link } from "react-router";
import { Badge } from "@/components/reui/badge";
import { CatalogError } from "@/components/releases/CatalogError";
import { useReleaseCatalog } from "@/components/releases/useReleaseCatalog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useChangedSinceMount } from "@/hooks/useChangedSinceMount";
import { useI18n } from "@/i18n/context";
import { buildsBySize, defaultRelease } from "@/lib/firmware/catalog";
import { profileById } from "@/lib/firmware/policy";
import { cn } from "cn";

export function LatestRelease() {
  const { catalog, reload } = useReleaseCatalog();
  const { t } = useI18n();
  // The answer replaces the skeleton with a reveal; a catalog that is already there rides on the page.
  const reveal = useChangedSinceMount(catalog.status) ? "enter-reveal" : undefined;
  if (catalog.status === "loading") return <Skeleton className="h-9 w-full max-w-md" role="status" aria-label={t.releases.loadingLatest} />;
  if (catalog.status === "error")
    return (
      <div className={reveal}>
        <CatalogError message={catalog.message} onRetry={reload} />
      </div>
    );
  const latest = defaultRelease(catalog.catalog);
  if (!latest) return <p className={cn("text-muted-foreground", reveal)}>{t.common.noFirmwareRelease}</p>;
  const sizes = buildsBySize(latest.manifest.builds)
    .filter((b) => b.image === "fido")
    .map((b) => profileById(b.profile_id)?.label ?? b.flash_size);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", reveal)}>
      <span className="font-heading text-lg font-semibold">{latest.name}</span>
      <Badge variant={latest.prerelease ? "warning-light" : "success-light"}>{latest.prerelease ? t.common.preRelease : t.common.stable}</Badge>
      {sizes.map((s) => (
        <Badge key={s} variant="outline">
          {s}
        </Badge>
      ))}
      <Button asChild variant="link">
        <Link to="/releases">{t.releases.allReleases}</Link>
      </Button>
    </div>
  );
}
