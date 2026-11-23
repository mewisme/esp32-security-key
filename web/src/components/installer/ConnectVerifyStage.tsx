import { ChevronDown, Usb } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import type { Installer } from "@/hooks/useInstaller";
import { ERRORS } from "@/lib/errors/catalog";
import { PHASES, type Phase } from "@/lib/flashing/machine";
import { formatBytes } from "@/lib/format";
import { CheckRow, CompatibilityBadge, type RowState, StageCard } from "./StageCard";

const SEQUENCE = [
  "Unplug the board from the computer.",
  "Press and hold the BOOT button.",
  "While holding BOOT, plug the board into the computer using the connector labelled USB or OTG.",
  "Let go of BOOT.",
  "Click “Choose device” below and pick “USB JTAG/serial debug unit” or an entry that mentions ESP32-S3, then click Connect.",
];

function BootSequence() {
  return (
    <div className="flex flex-col gap-4">
      <p>Put the board in download mode so it can receive new firmware:</p>
      <ol className="flex flex-col gap-3">
        {SEQUENCE.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-medium text-primary">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">
        Board with an RST button? You can also keep it plugged in: hold BOOT, press and release RST, then release BOOT.
      </p>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            The board isn't in the list <ChevronDown aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pt-2 text-sm">
          {(["power-only-cable", "wrong-connector", "multiple-devices"] as const).map((c) => (
            <div key={c} className="flex flex-col gap-1">
              <p className="font-medium">{ERRORS[c].title}</p>
              <p className="text-muted-foreground">{ERRORS[c].what}</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {ERRORS[c].next.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
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

  if (phase === "requesting-permission") {
    return (
      <StageCard
        title="Connect & verify"
        description="Connect the board in download mode. Nothing is written yet."
        headingRef={headingRef}
        secondary={
          <Button type="button" variant="outline" onClick={actions.back}>
            Back
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
            <Usb aria-hidden /> Choose device
          </Button>
        }
      >
        <BootSequence />
      </StageCard>
    );
  }

  const { received, total } = state.download;
  const pct = total ? Math.round((received / total) * 100) : 0;
  const downloading = phase === "downloading";
  const psram = chip ? /PSRAM (\d+)MB/i.exec(chip.features.join(" "))?.[1] : undefined;

  return (
    <StageCard
      title="Connect & verify"
      description="Reading the board and the firmware. Nothing is written yet."
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={() => void actions.cancel()}>
          Cancel
        </Button>
      }
    >
      <ul className="flex flex-col gap-3" aria-live="polite" data-testid="checks">
        <CheckRow label="Device permission" state={rowState(phase, "connecting")}>
          {PHASES.indexOf(phase) > PHASES.indexOf("connecting") ? "Granted" : null}
        </CheckRow>
        <CheckRow label="Chip" state={rowState(phase, "detecting-chip")}>
          {chip ? (chip.description || chip.chipName) : null}
        </CheckRow>
        <CheckRow label="Flash" state={rowState(phase, "validating-compatibility")}>
          {chip ? `${chip.flashSize ?? "unknown"}${chip.flashType ? ` · ${chip.flashType}` : ""}` : null}
        </CheckRow>
        <CheckRow label="PSRAM" state={rowState(phase, "validating-compatibility")}>
          {chip ? (psram ? `${psram} MB, not used` : "None — not required") : null}
        </CheckRow>
        <CheckRow label="Firmware profile" state={rowState(phase, "validating-compatibility")}>
          {selection ? (
            <>
              MultiKeys FIDO2 — <span className="whitespace-nowrap">{selection.profile.label}</span>
            </>
          ) : null}
        </CheckRow>
        <CheckRow label="Compatibility" state={rowState(phase, "validating-compatibility")}>
          {selection ? <CompatibilityBadge support={selection.support} verifiedAs={selection.verifiedAs} /> : null}
        </CheckRow>
        <CheckRow
          label="Download"
          state={rowState(phase, "fetching-metadata", "downloading")}
          below={downloading ? <Progress value={pct} aria-label="Download progress" /> : undefined}
        >
          {downloading ? `${formatBytes(received)} of ${formatBytes(total)}` : state.milestones.downloaded ? formatBytes(total) : null}
        </CheckRow>
        <CheckRow label="Checksums" state={rowState(phase, "verifying-integrity")}>
          {state.milestones.integrityVerified ? "Verified" : null}
        </CheckRow>
        <CheckRow label="Storage layout" state={rowState(phase, "checking-flash-safety")}>
          {state.decision ? "Read (read-only)" : null}
        </CheckRow>
      </ul>
    </StageCard>
  );
}
