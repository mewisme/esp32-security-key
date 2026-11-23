import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Installer } from "@/hooks/useInstaller";
import { useI18n } from "@/i18n/context";
import { PHASES } from "@/lib/flashing/machine";
import { formatBytes } from "@/lib/format";
import { CheckRow, type RowState, StageCard } from "./StageCard";

const ROWS = [{ phase: "flashing" }, { phase: "verifying-flash" }, { phase: "rebooting" }] as const;

export function InstallStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t, locale } = useI18n();
  const { state } = inst;
  const { written, total } = state.progress;
  const pct = total ? Math.round((written / total) * 100) : 0;
  const now = PHASES.indexOf(state.phase);
  const flashing = state.phase === "flashing";
  return (
    <StageCard
      title={t.install.steps.install}
      description={t.install.installing.description}
      headingRef={headingRef}
      secondary={
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-block">
              <Button type="button" variant="outline" disabled>
                {t.common.cancel}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t.install.installing.cancelTip}</TooltipContent>
        </Tooltip>
      }
    >
      <p className="font-medium">{t.install.installing.warning}</p>
      <ul className="flex flex-col gap-3" aria-live="polite">
        {ROWS.map((r) => {
          const idx = PHASES.indexOf(r.phase);
          const rs: RowState = idx < now ? "done" : idx === now ? "active" : "waiting";
          return <CheckRow key={r.phase} label={t.install.installing.rows[r.phase]} state={rs} />;
        })}
      </ul>
      <div className="flex flex-col gap-2">
        <Label id="flash-label">
          {flashing ? t.install.installing.written(formatBytes(written, locale), formatBytes(total, locale), pct) : t.install.installing.verifying}
        </Label>
        {/* The bar is full while the key is read back and restarted, which has no progress to show: it pulses so it is not mistaken for finished. */}
        <Progress value={flashing ? pct : 100} aria-labelledby="flash-label" className={flashing ? undefined : "animate-pulse"} />
      </div>
      <p className="text-sm text-muted-foreground">{t.install.installing.note}</p>
    </StageCard>
  );
}
