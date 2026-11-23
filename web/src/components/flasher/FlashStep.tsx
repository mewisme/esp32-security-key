import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/format";
import type { FlashState } from "@/lib/flashing/machine";
import { PhaseList } from "./PhaseList";

export function FlashStep({ state }: { state: FlashState }) {
  const { written, total } = state.progress;
  const pct = total ? Math.round((written / total) * 100) : 0;
  return (
    <div className="space-y-5">
      <p className="font-medium">Don't unplug the board or close this tab.</p>
      <PhaseList
        current={state.phase}
        items={[
          { phase: "flashing", label: "Writing firmware" },
          { phase: "verifying-flash", label: "Reading it back to verify" },
        ]}
      />
      <div className="space-y-2">
        <Label id="flash-label">
          {state.phase === "flashing" ? `Written ${formatBytes(written)} of ${formatBytes(total)} (${pct}%)` : "Verifying…"}
        </Label>
        <Progress value={state.phase === "flashing" ? pct : 100} aria-labelledby="flash-label" />
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-block">
            <Button variant="outline" disabled>
              Cancel
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Stopping half-way would leave the board unable to start, so cancelling is disabled while writing.</TooltipContent>
      </Tooltip>
      <p className="text-sm text-muted-foreground">Cancelling is disabled while writing: stopping half-way would leave the board unable to start.</p>
    </div>
  );
}
