import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format";
import type { FlashState } from "@/lib/flashing/machine";
import { PhaseList } from "./PhaseList";

export function FirmwareCheckStep({ state }: { state: FlashState }) {
  const { received, total } = state.download;
  const pct = total ? Math.round((received / total) * 100) : 0;
  return (
    <div className="space-y-5">
      <PhaseList
        current={state.phase}
        items={[
          { phase: "fetching-metadata", label: "Checking the firmware description" },
          { phase: "downloading", label: "Downloading the firmware" },
          { phase: "verifying-integrity", label: "Verifying checksums" },
          { phase: "checking-flash-safety", label: "Reading the board's storage layout (read-only)" },
        ]}
      />
      {state.phase === "downloading" && (
        <div className="space-y-2">
          <Label id="dl-label">
            Downloaded {formatBytes(received)} of {formatBytes(total)}
          </Label>
          <Progress value={pct} aria-labelledby="dl-label" />
        </div>
      )}
    </div>
  );
}
