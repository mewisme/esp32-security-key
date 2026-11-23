import { CircleCheck, Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Spinner } from "@/components/common/Spinner";
import { StageCard } from "@/components/installer/StageCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Updater } from "@/hooks/useUpdater";
import { useI18n } from "@/i18n/context";
import type { UpdateVerdict } from "@/lib/flashing/update-report";

const VERDICT_ALERT = {
  verified: { variant: "success", Icon: CircleCheck },
  partial: { variant: "info", Icon: Info },
  unchecked: { variant: "warning", Icon: TriangleAlert },
  mismatch: { variant: "destructive", Icon: ShieldAlert },
} as const satisfies Record<UpdateVerdict, { variant: string; Icon: unknown }>;

function Result({ value }: { value: boolean | null }) {
  const { t } = useI18n();
  const r = t.update.verify.results;
  if (value === true) return <Badge variant="success-light">{r.yes}</Badge>;
  if (value === false) return <Badge variant="destructive-light">{r.no}</Badge>;
  return <Badge variant="warning-light">{r.unknown}</Badge>;
}

export function VerifyStage({ up, headingRef }: { up: Updater; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t } = useI18n();
  const { state, actions } = up;
  const [busy, setBusy] = useState(false);
  const v = t.update.verify;

  if (state.phase === "done" && state.report) {
    const rep = state.report;
    const { variant, Icon } = VERDICT_ALERT[rep.verdict];
    const rows = [
      { id: "image", value: rep.imageMatches },
      { id: "version", value: rep.versionMatches },
      { id: "name", value: rep.nameUnchanged },
      { id: "mkauth", value: rep.mkauthUnchanged },
    ] as const;
    return (
      <StageCard
        title={t.update.steps.verify}
        description={v.doneDescription}
        headingRef={headingRef}
        primary={
          <Button type="button" onClick={() => void actions.reset()}>
            {v.again}
          </Button>
        }
      >
        <Alert variant={variant} data-testid="update-verdict" data-verdict={rep.verdict}>
          <Icon aria-hidden />
          <AlertTitle>{v.verdicts[rep.verdict].title}</AlertTitle>
          <AlertDescription>{v.verdicts[rep.verdict].text}</AlertDescription>
        </Alert>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{v.table.check}</TableHead>
              <TableHead>{v.table.result}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-testid={`verify-${row.id}`}>
                <TableCell className="whitespace-normal">{v.rows[row.id]}</TableCell>
                <TableCell>
                  <Result value={row.value} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow data-testid="verify-fido">
              <TableCell className="whitespace-normal">{v.rows.fido}</TableCell>
              <TableCell className="whitespace-normal">
                <Result value={null} />
                <span className="mt-1 block text-xs text-muted-foreground">{v.fidoNote}</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div>
          <Button asChild variant="outline">
            <Link to="/passkeys">{v.passkeyTest}</Link>
          </Button>
        </div>
      </StageCard>
    );
  }

  const checking = state.phase === "verifying-device";
  const canCheck = state.target?.build.image === "fido";
  return (
    <StageCard
      title={t.update.steps.verify}
      description={v.replugDescription}
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" disabled={checking} onClick={actions.skipVerify}>
          {t.install.finish.key.skip}
        </Button>
      }
      primary={
        canCheck ? (
          <Button
            type="button"
            disabled={busy || checking}
            onClick={() => {
              setBusy(true);
              void actions.verifyDevice().finally(() => setBusy(false));
            }}
          >
            {checking ? <Spinner /> : null} {checking ? v.checking : t.common.checkMyKey}
          </Button>
        ) : undefined
      }
    >
      <p className="font-medium">{t.install.finish.key.replug}</p>
      <p className="text-sm text-muted-foreground">{t.install.finish.key.replugWhy}</p>
    </StageCard>
  );
}
