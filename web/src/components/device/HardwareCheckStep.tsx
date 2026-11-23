import { PhaseList } from "@/components/flasher/PhaseList";
import type { ChipInfo } from "@/lib/flashing/driver";
import type { Phase } from "@/lib/flashing/machine";

export function ChipSummary({ chip }: { chip: ChipInfo }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Chip</dt>
      <dd>{chip.description || chip.chipName}</dd>
      <dt className="text-muted-foreground">Flash</dt>
      <dd>{chip.flashSize ?? "unknown"}</dd>
      <dt className="text-muted-foreground">MAC</dt>
      <dd className="font-mono">{chip.mac ?? "not read"}</dd>
      <dt className="text-muted-foreground">Features</dt>
      <dd>{chip.features.join(", ") || "—"} (PSRAM is not used by MultiKeys)</dd>
    </dl>
  );
}

export function HardwareCheckStep({ phase, chip }: { phase: Phase; chip: ChipInfo | null }) {
  return (
    <div className="space-y-5">
      <PhaseList
        current={phase}
        items={[
          { phase: "connecting", label: "Connecting to the board" },
          { phase: "detecting-chip", label: "Identifying the chip" },
          { phase: "validating-compatibility", label: "Checking chip and flash size" },
        ]}
      />
      {chip && <ChipSummary chip={chip} />}
    </div>
  );
}
