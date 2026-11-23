import { Info, ShieldAlert, TriangleAlert, Usb } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { BootSequence } from "@/components/installer/ConnectVerifyStage";
import { CheckRow, CompatibilityBadge, type RowState, StageCard } from "@/components/installer/StageCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Updater } from "@/hooks/useUpdater";
import { useI18n } from "@/i18n/context";
import { type AppUpdateOutcome, type TypedUpdateAckId, type UpdateAckId, UPDATE_TYPED_ACKS } from "@/lib/flashing/app-update";
import { formatBytes, formatHex } from "@/lib/format";

const BADGE = {
  "safe-update": "success-light",
  repair: "warning-light",
  "already-current": "info-light",
  downgrade: "destructive-light",
  incompatible: "destructive-light",
  unknown: "warning-light",
  "different-family": "warning-light",
  "not-multikeys": "warning-light",
  "release-unsupported": "warning-light",
} as const satisfies Record<AppUpdateOutcome, string>;

/** Outcomes for which the installer is the way forward (it asks for the confirmations those cases need). */
const INSTALLER_OUTCOMES: readonly AppUpdateOutcome[] = ["different-family", "not-multikeys", "unknown", "incompatible", "release-unsupported"];

export function ReviewStage({ up, headingRef }: { up: Updater; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t, locale } = useI18n();
  const { state, actions } = up;
  const [busy, setBusy] = useState(false);
  const [acks, setAcks] = useState<UpdateAckId[]>([]);
  const [typed, setTyped] = useState<Partial<Record<TypedUpdateAckId, string>>>({});
  const r = t.update.review;

  if (state.phase === "awaiting-boot") {
    return (
      <StageCard
        title={t.update.steps.review}
        description={r.bootDescription}
        headingRef={headingRef}
        secondary={
          <Button type="button" variant="outline" onClick={actions.back}>
            {t.common.back}
          </Button>
        }
        primary={
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void actions.choosePort().finally(() => setBusy(false));
            }}
          >
            <Usb aria-hidden /> {t.install.connect.chooseDevice}
          </Button>
        }
      >
        <BootSequence />
      </StageCard>
    );
  }

  if (state.phase === "choosing") {
    const order = ["connecting", "downloading", "reading"] as const;
    const at = state.stage ? order.indexOf(state.stage) : 0;
    const rowState = (i: number): RowState => (i < at ? "done" : i === at ? "active" : "waiting");
    const { received, total } = state.download ?? { received: 0, total: 0 };
    const pct = total ? Math.round((received / total) * 100) : 0;
    return (
      <StageCard title={t.update.steps.review} description={r.workingDescription} headingRef={headingRef}>
        <ul className="flex flex-col gap-3" aria-live="polite">
          <CheckRow label={r.rows.connect} state={rowState(0)} />
          <CheckRow
            label={r.rows.download}
            state={rowState(1)}
            below={state.stage === "downloading" ? <Progress value={pct} aria-label={r.rows.download} /> : undefined}
          >
            {at >= 1 && total ? t.install.connect.rows.downloaded(formatBytes(received, locale), formatBytes(total, locale)) : null}
          </CheckRow>
          <CheckRow label={r.rows.read} state={rowState(2)} />
        </ul>
      </StageCard>
    );
  }

  const { decision, target } = state;
  if (!decision || !target) return null;
  const { build, release, profile, support } = target;

  const given: UpdateAckId[] = [...acks, ...(Object.keys(UPDATE_TYPED_ACKS) as TypedUpdateAckId[]).filter((a) => typed[a] === UPDATE_TYPED_ACKS[a])];
  const ready = decision.allowed && decision.acks.every((a) => given.includes(a));
  const text = r.outcomes[decision.reason];
  const outcomeVariant = decision.allowed ? "info" : decision.outcome === "already-current" ? "success" : "warning";
  const installerLink = INSTALLER_OUTCOMES.includes(decision.outcome);

  return (
    <StageCard
      title={t.update.steps.review}
      description={r.description}
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={() => void actions.reset()}>
          {decision.allowed ? t.common.cancel : t.common.startOver}
        </Button>
      }
      primary={
        decision.allowed ? (
          <Button type="button" disabled={!ready} onClick={() => void actions.confirm(given)}>
            {r.confirm}
          </Button>
        ) : installerLink ? (
          <Button asChild>
            <Link to="/install">{r.openInstaller}</Link>
          </Button>
        ) : undefined
      }
    >
      <Alert variant={outcomeVariant} data-testid="update-outcome" data-outcome={decision.outcome} data-reason={decision.reason}>
        {decision.allowed ? <Info aria-hidden /> : <ShieldAlert aria-hidden />}
        <AlertTitle className="flex flex-wrap items-center gap-2">
          {text.title} <Badge variant={BADGE[decision.outcome]}>{r.labels[decision.outcome]}</Badge>
        </AlertTitle>
        <AlertDescription>
          <p>{text.text}</p>
          <p className="text-xs" lang="en">
            {decision.detail}
          </p>
          {decision.outcome === "release-unsupported" && (
            <Button asChild variant="link">
              <Link to="/releases">{r.seeReleases}</Link>
            </Button>
          )}
          {decision.reason === "recovery-unverified" && (
            <Button type="button" variant="outline" onClick={() => void actions.discardPending()}>
              {r.discardRecord}
            </Button>
          )}
        </AlertDescription>
      </Alert>

      <Table>
        <TableBody>
          <TableRow>
            <TableHead scope="row">{r.table.installed}</TableHead>
            <TableCell className="whitespace-normal" lang="en">
              {decision.installed.project && decision.installed.version ? `${decision.installed.project} ${decision.installed.version}` : r.unreadable}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">{r.table.offered}</TableHead>
            <TableCell className="whitespace-normal">{t.install.review.buildLine(build.title, build.version, release.tag)}</TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">{r.table.flash}</TableHead>
            <TableCell className="whitespace-normal">{profile.label}</TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">{t.install.review.rows.compatibility}</TableHead>
            <TableCell className="whitespace-normal">
              <CompatibilityBadge support={support} />
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">{r.table.type}</TableHead>
            <TableCell className="font-medium whitespace-normal" data-testid="update-type">
              {r.type}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      {decision.allowed && (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">{t.install.review.writes.title}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.install.review.writes.address}</TableHead>
                  <TableHead>{t.install.review.writes.size}</TableHead>
                  <TableHead>{t.install.review.writes.what}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decision.writes.map((w) => (
                  <TableRow key={w.offset}>
                    <TableCell className="font-mono">{formatHex(w.offset)}</TableCell>
                    <TableCell>{formatBytes(w.length, locale)}</TableCell>
                    <TableCell>{t.install.review.writes.roles[w.role] ?? w.role}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground">{r.untouched}</p>
          </div>

          <Alert>
            <Info aria-hidden />
            <AlertTitle>{r.data.title}</AlertTitle>
            <AlertDescription>{r.data.text}</AlertDescription>
          </Alert>

          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertTitle>{t.update.notAtomic.title}</AlertTitle>
            <AlertDescription>{t.update.notAtomic.text}</AlertDescription>
          </Alert>

          <FieldSet>
            <legend className="mb-1 font-medium">{r.before.legend}</legend>
            {decision.acks
              .filter((a): a is Exclude<UpdateAckId, TypedUpdateAckId> => !(a in UPDATE_TYPED_ACKS))
              .map((a) => (
                <Field key={a} orientation="horizontal">
                  <Checkbox
                    id={`ack-${a}`}
                    checked={acks.includes(a)}
                    onCheckedChange={(v) => setAcks((cur) => (v === true ? [...cur, a] : cur.filter((x) => x !== a)))}
                  />
                  <Label htmlFor={`ack-${a}`} className="font-normal">
                    {r.before.acks[a]}
                  </Label>
                </Field>
              ))}
            {decision.acks
              .filter((a): a is TypedUpdateAckId => a in UPDATE_TYPED_ACKS)
              .map((a) => (
                <Field key={a}>
                  <Label htmlFor={`typed-${a}`}>{r.before.typedLabels[a]}</Label>
                  <Input
                    id={`typed-${a}`}
                    value={typed[a] ?? ""}
                    onChange={(e) => setTyped((cur) => ({ ...cur, [a]: e.target.value }))}
                    autoComplete="off"
                    className="max-w-xs font-mono"
                  />
                </Field>
              ))}
          </FieldSet>
        </>
      )}
    </StageCard>
  );
}
