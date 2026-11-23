import { Link } from "react-router";
import { Badge } from "@/components/reui/badge";
import { AsyncState } from "@/components/common/AsyncState";
import { useReleaseCatalog } from "@/components/releases/useReleaseCatalog";
import { Button } from "@/components/ui/button";
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
  if (catalog.status === "loading") return <AsyncState state="loading" label={t.releases.loadingLatest} rows={1} />;
  if (catalog.status === "error")
    return (
      <div className={reveal}>
        <AsyncState state="error" title={t.releases.loadFailed} message={catalog.message} retryLabel={t.common.retry} onRetry={reload} />
      </div>
    );
  const latest = defaultRelease(catalog.catalog);
  if (!latest) return <AsyncState state="empty" title={t.common.noFirmwareRelease} />;
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
