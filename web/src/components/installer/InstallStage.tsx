import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Installer } from "@/hooks/useInstaller";
import { PHASES } from "@/lib/flashing/machine";
import { formatBytes } from "@/lib/format";
import { CheckRow, type RowState, StageCard } from "./StageCard";

const ROWS = [
  { phase: "flashing", label: "Writing firmware" },
  { phase: "verifying-flash", label: "Reading it back to verify" },
  { phase: "rebooting", label: "Restarting the board" },
] as const;

export function InstallStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { state } = inst;
  const { written, total } = state.progress;
  const pct = total ? Math.round((written / total) * 100) : 0;
  const now = PHASES.indexOf(state.phase);
  const flashing = state.phase === "flashing";
  return (
    <StageCard
      title="Install"
      description="Writing the firmware to the board."
      headingRef={headingRef}
      secondary={
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-block">
              <Button type="button" variant="outline" disabled>
                Cancel
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Stopping half-way would leave the board unable to start, so cancelling is disabled while writing.</TooltipContent>
        </Tooltip>
      }
    >
      <p className="font-medium">Don't unplug the board or close this tab.</p>
      <ul className="flex flex-col gap-3" aria-live="polite">
        {ROWS.map((r) => {
          const idx = PHASES.indexOf(r.phase);
          const rs: RowState = idx < now ? "done" : idx === now ? "active" : "waiting";
          return <CheckRow key={r.phase} label={r.label} state={rs} />;
        })}
      </ul>
      <div className="flex flex-col gap-2">
        <Label id="flash-label">{flashing ? `Written ${formatBytes(written)} of ${formatBytes(total)} (${pct}%)` : "Verifying…"}</Label>
        <Progress value={flashing ? pct : 100} aria-labelledby="flash-label" />
      </div>
      <p className="text-sm text-muted-foreground">Cancelling is disabled while writing: stopping half-way would leave the board unable to start.</p>
    </StageCard>
  );
}
