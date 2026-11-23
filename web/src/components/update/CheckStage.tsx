import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { Spinner } from "@/components/common/Spinner";
import { ReleaseBadges } from "@/components/installer/FirmwareStage";
import { StageCard } from "@/components/installer/StageCard";
import { formatDate } from "@/components/releases/format-date";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { Updater } from "@/hooks/useUpdater";
import { useI18n } from "@/i18n/context";

export function CheckStage({ up, headingRef }: { up: Updater; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t, locale } = useI18n();
  const { state, actions, catalog, latest, offers, selected } = up;
  const c = t.update.check;
  const snap = state.baseline?.status === "ok" ? state.baseline.snapshot : null;
  const installedLabel = snap?.build?.version ? `${snap.build.project ?? ""} ${snap.build.version}`.trim() : c.notRead;
  const latestApp = latest?.build.images.find((i) => i.role === "app");
  const upToDate = !!latestApp && !!snap?.build?.imageSha256 && snap.build.imageSha256 === latestApp.sha256;
  const unsupported = !!selected && selected.build.update.app_only !== true;
  const nothingNewer = catalog.status === "ready" && !!latest && !selected && !upToDate;
  // "Latest" means the newest stable release; the newest release overall may be a pre-release.
  const latestStableTag = catalog.status === "ready" ? catalog.catalog.releases.find((r) => !r.prerelease)?.tag : undefined;

  let primary: React.ReactNode;
  if (upToDate) {
    primary = (
      <Button type="button" onClick={() => void actions.reset()}>
        {t.common.startOver}
      </Button>
    );
  } else if (selected && !unsupported) {
    primary = (
      <Button type="button" onClick={actions.toReview}>
        {t.common.continue}
      </Button>
    );
  }

  return (
    <StageCard
      title={t.update.steps.check}
      description={c.description}
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={actions.back}>
          {t.common.back}
        </Button>
      }
      primary={primary}
    >
      {catalog.status === "loading" && (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Spinner className="size-4" /> {c.loading}
        </p>
      )}
      {catalog.status === "error" && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t.install.firmware.listFailed}</AlertTitle>
          <AlertDescription>
            <p>{t.install.firmware.checkConnection}</p>
            <Button type="button" variant="outline" onClick={actions.loadCatalog}>
              {t.common.retry}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {catalog.status === "ready" && !latest && (
        <Alert>
          <Info aria-hidden />
          <AlertDescription>{c.noRelease}</AlertDescription>
        </Alert>
      )}
      {selected && (
        <Table>
          <TableBody>
            <TableRow>
              <TableHead scope="row">{c.installed}</TableHead>
              <TableCell className="whitespace-normal" lang="en">
                {installedLabel}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableHead scope="row">{c.offered}</TableHead>
              <TableCell className="whitespace-normal">{c.versionLine(selected.build.title, selected.build.version, selected.release.tag)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
      {offers.length > 1 && selected && (
        <Field className="sm:max-w-80">
          <Label htmlFor="update-release-select" className="text-xs text-muted-foreground">
            {t.install.firmware.chooseVersion}
          </Label>
          <Select value={selected.release.tag} onValueChange={actions.setRelease}>
            <SelectTrigger id="update-release-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {offers.map(({ release }) => (
                  <SelectItem key={release.tag} value={release.tag}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium tabular-nums">v{release.manifest.version}</span>
                      <ReleaseBadges release={release} latestStable={release.tag === latestStableTag} />
                      {release.publishedAt && <span className="text-xs text-muted-foreground">{formatDate(release.publishedAt, locale)}</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}
      {upToDate && (
        <Alert variant="success">
          <CircleCheck aria-hidden />
          <AlertTitle>{c.upToDate.title}</AlertTitle>
          <AlertDescription>{c.upToDate.text}</AlertDescription>
        </Alert>
      )}
      {nothingNewer && (
        <Alert>
          <Info aria-hidden />
          <AlertDescription>{c.nothingNewer}</AlertDescription>
        </Alert>
      )}
      {selected && unsupported && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>{c.unsupported.title}</AlertTitle>
          <AlertDescription>
            <p>{c.unsupported.text(selected.release.tag)}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/install">{c.useInstaller}</Link>
              </Button>
              <Button asChild variant="link">
                <Link to="/releases">{t.update.review.seeReleases}</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </StageCard>
  );
}
