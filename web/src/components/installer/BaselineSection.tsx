import { Usb } from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/common/Spinner";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { Installer } from "@/hooks/useInstaller";
import { useI18n } from "@/i18n/context";

/** Optional, read-only: what the running key reports now, so the page can refuse another key and compare after the write. */
export function BaselineSection({ inst }: { inst: Installer }) {
  const { t } = useI18n();
  const { baseline, actions } = inst;
  const b = t.install.firmware.baseline;
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const usbSupported = typeof navigator !== "undefined" && "usb" in navigator;
  const build = baseline?.build ?? null;

  const read = () => {
    setReading(true);
    setFailed(false);
    void actions
      .readBaseline()
      .then((ok) => setFailed(!ok))
      .finally(() => setReading(false));
  };

  return (
    <FieldSet className="gap-3" data-testid="baseline">
      <FieldLegend variant="label">{b.title}</FieldLegend>
      <FieldDescription>{b.text}</FieldDescription>
      {baseline ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{b.reported}</h3>
          <Table>
            <TableBody>
              <TableRow>
                <TableHead scope="row">{b.rows.firmware}</TableHead>
                <TableCell className="whitespace-normal" lang="en">
                  {build?.project && build.version ? `${build.project} ${build.version}` : b.unreadable}
                </TableCell>
              </TableRow>
              {build?.commit && (
                <TableRow>
                  <TableHead scope="row">{b.rows.commit}</TableHead>
                  <TableCell className="font-mono whitespace-normal">{build.commit}</TableCell>
                </TableRow>
              )}
              {build?.imageSha256 && (
                <TableRow>
                  <TableHead scope="row">{b.rows.image}</TableHead>
                  <TableCell className="font-mono text-xs break-all whitespace-normal">{build.imageSha256}</TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableHead scope="row">{b.rows.name}</TableHead>
                <TableCell className="whitespace-normal">{baseline.name ?? b.unreadable}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead scope="row">{b.rows.pin}</TableHead>
                <TableCell className="whitespace-normal">{baseline.enrolled === null ? b.unreadable : baseline.enrolled ? b.pinSet : b.pinNotSet}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {baseline.buildOutdated && <p className="text-sm text-muted-foreground">{b.outdated}</p>}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={actions.clearBaseline}>
              {b.clear}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <Button type="button" variant="outline" disabled={reading || !usbSupported} onClick={read}>
              {reading ? <Spinner /> : <Usb aria-hidden />} {reading ? b.reading : b.choose}
            </Button>
          </div>
          {!usbSupported && (
            <Alert variant="warning">
              <AlertDescription>{b.unsupported}</AlertDescription>
            </Alert>
          )}
          {failed && (
            <Alert variant="warning" role="status">
              <AlertDescription>{b.failed}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </FieldSet>
  );
}
