import { Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Installer, isUartBridge } from "@/hooks/useInstaller";
import { useI18n } from "@/i18n/context";
import { type AckId, TYPED_ACKS, type TypedAckId } from "@/lib/flashing/install-mode";
import { formatBytes, formatHex } from "@/lib/format";
import { CompatibilityBadge, StageCard } from "./StageCard";

export function ReviewStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { state, selection, actions, config } = inst;
  const { decision, chip } = state;
  const [acks, setAcks] = useState<AckId[]>([]);
  const [typed, setTyped] = useState<Partial<Record<TypedAckId, string>>>({});
  const { t, locale } = useI18n();
  if (!decision || !selection) return null;
  const { build, release, profile, support } = selection;

  const given: AckId[] = [
    ...acks,
    ...(Object.keys(TYPED_ACKS) as TypedAckId[]).filter((a) => typed[a] === TYPED_ACKS[a]),
  ];
  const ready = decision.acks.every((a) => given.includes(a));
  const filled = new Set(decision.writes.filter((w) => w.kind === "fill").map((w) => w.role));
  const untouched = build.protected_partitions.filter((p) => !filled.has(p));
  const req = config.name;
  const nameWords =
    req.mode === "keep" ? t.install.review.keepName : req.mode === "default" ? t.install.review.resetName(build.usb.product_name) : req.name;
  const untested = decision.acks.includes("untested-hardware");

  return (
    <StageCard
      title={t.install.steps.review}
      description={t.install.review.description}
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={() => void actions.cancel()}>
          {t.common.cancel}
        </Button>
      }
      primary={
        <Button type="button" disabled={!ready} onClick={() => void actions.confirm(given)}>
          {t.install.review.confirm}
        </Button>
      }
    >
      <Table>
        <TableBody>
          <TableRow>
            <TableHead scope="row">{t.install.review.rows.board}</TableHead>
            <TableCell className="whitespace-normal">
              {chip?.description || chip?.chipName || "?"}
              <span className="block text-xs text-muted-foreground">
                MAC <span className="font-mono">{chip?.mac ?? "?"}</span>
              </span>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">{t.install.review.rows.flash}</TableHead>
            <TableCell className="whitespace-normal">
              {chip?.flashSize ?? profile.flash_size} · {chip?.flashType ?? profile.flash_interface}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">{t.common.firmware}</TableHead>
            <TableCell className="whitespace-normal">
              <span className="font-medium">{t.install.firmwareName(profile.label)}</span>
              <span className="block text-xs text-muted-foreground">{t.install.review.buildLine(build.title, build.version, release.tag)}</span>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">{t.install.review.rows.compatibility}</TableHead>
            <TableCell className="whitespace-normal">
              <CompatibilityBadge support={support} />
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">{t.common.deviceName}</TableHead>
            <TableCell className="whitespace-normal">{nameWords}</TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">{t.install.review.rows.installMode}</TableHead>
            <TableCell className="font-medium whitespace-normal" data-testid="install-mode">
              {t.install.review.modes[decision.mode]}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

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
              <TableRow key={`${w.kind}-${w.offset}`}>
                <TableCell className="font-mono">{formatHex(w.offset)}</TableCell>
                <TableCell>{formatBytes(w.length, locale)}</TableCell>
                <TableCell>{w.kind === "fill" ? t.install.review.writes.clear(w.role) : (t.install.review.writes.roles[w.role] ?? w.role)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-sm text-muted-foreground">{t.install.review.writes.neverTouched(untouched)}</p>
      </div>

      {decision.mode === "switch-image" && (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertTitle>{t.install.review.switchWarning.title}</AlertTitle>
          <AlertDescription>
            <p>{t.install.review.switchWarning.text}</p>
          </AlertDescription>
        </Alert>
      )}

      {decision.mode === "update" && build.update.app_only === true && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>{t.install.review.updateHint.title}</AlertTitle>
          <AlertDescription>
            <p>{t.install.review.updateHint.text}</p>
            <Button asChild variant="link">
              <Link to="/update">{t.install.review.updateHint.link}</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Alert variant={decision.mode === "repurpose" || decision.mode === "update-forced" ? "destructive" : "default"}>
        {decision.mode === "repurpose" || decision.mode === "update-forced" ? <ShieldAlert aria-hidden /> : <Info aria-hidden />}
        <AlertTitle>{t.install.review.data.title}</AlertTitle>
        <AlertDescription>
          <p>
            {decision.mode === "blocked"
              ? t.errors["storage-incompatible"].what
              : t.install.review.data.risk[decision.mode](build.update.data_preserving_from)}
          </p>
          <p className="text-xs">
            {t.install.review.data.why} <span lang="en">{decision.reason}</span>
          </p>
        </AlertDescription>
      </Alert>

      {isUartBridge(state.port) && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>{t.errors["wrong-connector"].title}</AlertTitle>
          <AlertDescription>{t.errors["wrong-connector"].what}</AlertDescription>
        </Alert>
      )}

      {untested && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t.install.review.untested.title}</AlertTitle>
          <AlertDescription>
            <p>
              {support === "reference-config"
                ? t.install.review.untested.referenceConfig
                : support === "expected-compatible"
                  ? t.install.review.untested.expectedCompatible
                  : t.install.review.untested.buildVerified(profile.flash_size.replace("MB", " MB"))}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <FieldSet>
        <legend className="mb-1 font-medium">{t.install.review.before.legend}</legend>
        {decision.acks
          .filter((a): a is Exclude<AckId, TypedAckId> => !(a in TYPED_ACKS))
          .map((a) => (
            <Field key={a} orientation="horizontal">
              <Checkbox
                id={`ack-${a}`}
                checked={acks.includes(a)}
                onCheckedChange={(v) => setAcks((cur) => (v === true ? [...cur, a] : cur.filter((x) => x !== a)))}
              />
              <Label htmlFor={`ack-${a}`} className="font-normal">
                {t.install.review.before.acks[a]}
              </Label>
            </Field>
          ))}
        {decision.acks
          .filter((a): a is TypedAckId => a in TYPED_ACKS)
          .map((a) => (
            <Field key={a}>
              <Label htmlFor={`typed-${a}`}>{t.install.review.before.typedLabels[a]}</Label>
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
    </StageCard>
  );
}
