import { Link } from "react-router";
import { Badge } from "@/components/reui/badge";
import { CatalogError } from "@/components/releases/CatalogError";
import { useReleaseCatalog } from "@/components/releases/useReleaseCatalog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { buildsBySize, defaultRelease } from "@/lib/firmware/catalog";
import { profileById } from "@/lib/firmware/policy";

export function LatestRelease() {
  const { catalog, reload } = useReleaseCatalog();
  if (catalog.status === "loading") return <Skeleton className="h-9 w-full max-w-md" role="status" aria-label="Loading latest release" />;
  if (catalog.status === "error") return <CatalogError message={catalog.message} onRetry={reload} />;
  const latest = defaultRelease(catalog.catalog);
  if (!latest) return <p className="text-muted-foreground">No firmware release yet</p>;
  const sizes = buildsBySize(latest.manifest.builds)
    .filter((b) => b.image === "fido")
    .map((b) => profileById(b.profile_id)?.label ?? b.flash_size);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-heading text-lg font-semibold">{latest.name}</span>
      <Badge variant={latest.prerelease ? "warning-light" : "success-light"}>{latest.prerelease ? "Pre-release" : "Stable"}</Badge>
      {sizes.map((s) => (
        <Badge key={s} variant="outline">
          {s}
        </Badge>
      ))}
      <Button asChild variant="link">
        <Link to="/releases">All releases</Link>
      </Button>
    </div>
  );
}
