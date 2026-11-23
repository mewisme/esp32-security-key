import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { Spinner } from "@/components/common/Spinner";
import { StageCard } from "@/components/installer/StageCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { Updater } from "@/hooks/useUpdater";
import { useI18n } from "@/i18n/context";

export function CheckStage({ up, headingRef }: { up: Updater; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t } = useI18n();
  const { state, actions, catalog, latest } = up;
  const c = t.update.check;
  const snap = state.baseline?.status === "ok" ? state.baseline.snapshot : null;
  const installedLabel = snap?.build?.version ? `${snap.build.project ?? ""} ${snap.build.version}`.trim() : c.notRead;
  const appImage = latest?.build.images.find((i) => i.role === "app");
  const upToDate = !!appImage && !!snap?.build?.imageSha256 && snap.build.imageSha256 === appImage.sha256;
  const unsupported = !!latest && latest.build.update.app_only !== true;

  let primary: React.ReactNode;
  if (upToDate) {
    primary = (
      <Button type="button" onClick={() => void actions.reset()}>
        {t.common.startOver}
      </Button>
    );
  } else if (latest && !unsupported) {
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
      {latest && (
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
              <TableCell className="whitespace-normal">{c.versionLine(latest.build.title, latest.build.version, latest.release.tag)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
      {upToDate && (
        <Alert variant="success">
          <CircleCheck aria-hidden />
          <AlertTitle>{c.upToDate.title}</AlertTitle>
          <AlertDescription>{c.upToDate.text}</AlertDescription>
        </Alert>
      )}
      {latest && unsupported && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>{c.unsupported.title}</AlertTitle>
          <AlertDescription>
            <p>{c.unsupported.text(latest.release.tag)}</p>
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
