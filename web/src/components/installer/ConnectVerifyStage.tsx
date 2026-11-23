import { Usb } from "lucide-react";
import { useState } from "react";
import { Disclosure } from "@/components/common/Disclosure";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Installer } from "@/hooks/useInstaller";
import { useI18n } from "@/i18n/context";
import { PHASES, type Phase } from "@/lib/flashing/machine";
import { formatBytes } from "@/lib/format";
import { CheckRow, CompatibilityBadge, type RowState, StageCard } from "./StageCard";

export function BootSequence() {
  const { t } = useI18n();
  const boot = t.install.connect.boot;
  return (
    <div className="flex flex-col gap-4">
      <p>{boot.intro}</p>
      <ol className="flex flex-col gap-3">
        {boot.sequence.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-medium text-primary">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">{boot.rstTip}</p>
      <Disclosure label={boot.notListed} className="flex flex-col gap-3 pt-2 text-sm">
        {(["power-only-cable", "wrong-connector", "multiple-devices"] as const).map((c) => (
          <div key={c} className="flex flex-col gap-1">
            <p className="font-medium">{t.errors[c].title}</p>
            <p className="text-muted-foreground">{t.errors[c].what}</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {t.errors[c].next.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        ))}
      </Disclosure>
    </div>
  );
}

/** Row status from the machine's phase order: active from `from`, done once the machine has moved past `to`. */
function rowState(phase: Phase, from: Phase, to: Phase = from): RowState {
  const now = PHASES.indexOf(phase);
  if (now > PHASES.indexOf(to)) return "done";
  return now >= PHASES.indexOf(from) ? "active" : "waiting";
}

export function ConnectVerifyStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { state, selection, actions } = inst;
  const { phase, chip } = state;
  const [busy, setBusy] = useState(false);
  const { t, locale } = useI18n();

  if (phase === "requesting-permission") {
    return (
      <StageCard
        title={t.install.steps.connect}
        description={t.install.connect.requestDescription}
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

  const rows = t.install.connect.rows;
  const { received, total } = state.download;
  const pct = total ? Math.round((received / total) * 100) : 0;
  const downloading = phase === "downloading";
  const psram = chip ? /PSRAM (\d+)MB/i.exec(chip.features.join(" "))?.[1] : undefined;

  return (
    <StageCard
      title={t.install.steps.connect}
      description={t.install.connect.readingDescription}
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={() => void actions.cancel()}>
          {t.common.cancel}
        </Button>
      }
    >
      <ul className="flex flex-col gap-3" aria-live="polite" data-testid="checks">
        <CheckRow label={rows.permission} state={rowState(phase, "connecting")}>
          {PHASES.indexOf(phase) > PHASES.indexOf("connecting") ? rows.granted : null}
        </CheckRow>
        <CheckRow label={rows.chip} state={rowState(phase, "detecting-chip")}>
          {chip ? (chip.description || chip.chipName) : null}
        </CheckRow>
        <CheckRow label={rows.flash} state={rowState(phase, "validating-compatibility")}>
          {chip ? `${chip.flashSize ?? rows.flashUnknown}${chip.flashType ? ` · ${chip.flashType}` : ""}` : null}
        </CheckRow>
        <CheckRow label={rows.psram} state={rowState(phase, "validating-compatibility")}>
          {chip ? (psram ? rows.psramUnused(psram) : rows.psramNone) : null}
        </CheckRow>
        <CheckRow label={rows.profile} state={rowState(phase, "validating-compatibility")}>
          {selection ? t.install.firmwareName(<span className="whitespace-nowrap">{selection.profile.label}</span>) : null}
        </CheckRow>
        <CheckRow label={rows.compatibility} state={rowState(phase, "validating-compatibility")}>
          {selection ? <CompatibilityBadge support={selection.support} /> : null}
        </CheckRow>
        <CheckRow
          label={rows.download}
          state={rowState(phase, "fetching-metadata", "downloading")}
          below={downloading ? <Progress value={pct} aria-label={rows.downloadProgress} /> : undefined}
        >
          {downloading
            ? rows.downloaded(formatBytes(received, locale), formatBytes(total, locale))
            : state.milestones.downloaded
              ? formatBytes(total, locale)
              : null}
        </CheckRow>
        <CheckRow label={rows.checksums} state={rowState(phase, "verifying-integrity")}>
          {state.milestones.integrityVerified ? rows.verified : null}
        </CheckRow>
        <CheckRow label={rows.storage} state={rowState(phase, "checking-flash-safety")}>
          {state.decision ? rows.storageRead : null}
        </CheckRow>
      </ul>
    </StageCard>
  );
}
