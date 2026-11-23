import { Usb } from "lucide-react";
import { StageCard } from "@/components/installer/StageCard";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Spinner } from "@/components/common/Spinner";
import type { Updater } from "@/hooks/useUpdater";
import { useI18n } from "@/i18n/context";

export function InspectStage({ up, headingRef }: { up: Updater; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t } = useI18n();
  const { state, actions } = up;
  const c = t.update.connect;
  const inspecting = state.phase === "inspecting";
  const usbSupported = typeof navigator !== "undefined" && "usb" in navigator;

  if (state.phase === "inspected") {
    const snap = state.baseline?.status === "ok" ? state.baseline.snapshot : null;
    const build = snap?.build ?? null;
    return (
      <StageCard
        title={t.update.steps.connect}
        description={c.description}
        headingRef={headingRef}
        secondary={
          <Button type="button" variant="outline" onClick={actions.back}>
            {t.common.back}
          </Button>
        }
        primary={
          <Button type="button" onClick={actions.toCheck}>
            {t.common.continue}
          </Button>
        }
      >
        {snap ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">{c.reported}</h3>
            <Table>
              <TableBody>
                <TableRow>
                  <TableHead scope="row">{c.rows.firmware}</TableHead>
                  <TableCell className="whitespace-normal" lang="en">
                    {build?.project && build.version ? `${build.project} ${build.version}` : c.unreadable}
                  </TableCell>
                </TableRow>
                {build?.commit && (
                  <TableRow>
                    <TableHead scope="row">{c.rows.commit}</TableHead>
                    <TableCell className="font-mono whitespace-normal">{build.commit}</TableCell>
                  </TableRow>
                )}
                {build?.imageSha256 && (
                  <TableRow>
                    <TableHead scope="row">{c.rows.image}</TableHead>
                    <TableCell className="font-mono text-xs break-all whitespace-normal">{build.imageSha256}</TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableHead scope="row">{c.rows.name}</TableHead>
                  <TableCell className="whitespace-normal">{snap.name ?? c.unreadable}</TableCell>
                </TableRow>
                <TableRow>
                  <TableHead scope="row">{c.rows.pin}</TableHead>
                  <TableCell className="whitespace-normal">{snap.enrolled === null ? c.unreadable : snap.enrolled ? c.pinSet : c.pinNotSet}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {snap.buildOutdated && <p className="text-sm text-muted-foreground">{c.outdated}</p>}
          </div>
        ) : (
          <p className="text-muted-foreground">{c.skipNote}</p>
        )}
      </StageCard>
    );
  }

  return (
    <StageCard
      title={t.update.steps.connect}
      description={c.description}
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" disabled={inspecting} onClick={actions.skipInspect}>
          {c.skip}
        </Button>
      }
      primary={
        <Button type="button" disabled={inspecting || !usbSupported} onClick={() => void actions.inspect()}>
          {inspecting ? <Spinner /> : <Usb aria-hidden />} {inspecting ? c.reading : c.choose}
        </Button>
      }
    >
      <p>{c.hint}</p>
      <p className="text-sm text-muted-foreground">{c.skipNote}</p>
      {!usbSupported && (
        <Alert variant="warning">
          <AlertDescription>{c.unsupported}</AlertDescription>
        </Alert>
      )}
      {state.inspectNote && (
        <Alert variant="warning" role="status">
          <AlertDescription>{state.inspectNote === "not-chosen" ? c.notChosen : c.failed}</AlertDescription>
        </Alert>
      )}
    </StageCard>
  );
}
