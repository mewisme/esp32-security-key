import { CheckRow, type RowState, StageCard } from "@/components/installer/StageCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Updater, UpdatePhase } from "@/hooks/useUpdater";
import { useI18n } from "@/i18n/context";
import { formatBytes } from "@/lib/format";

const ROWS = [
  { phase: "updating", label: "flashing" },
  { phase: "verifying-flash", label: "verifying-flash" },
  { phase: "rebooting", label: "rebooting" },
] as const satisfies readonly { phase: UpdatePhase; label: "flashing" | "verifying-flash" | "rebooting" }[];

export function UpdateStage({ up, headingRef }: { up: Updater; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t, locale } = useI18n();
  const { state } = up;
  const { written, total } = state.progress ?? { written: 0, total: 0 };
  const pct = total ? Math.round((written / total) * 100) : 0;
  const now = ROWS.findIndex((r) => r.phase === state.phase);
  const writing = state.phase === "updating";
  return (
    <StageCard
      title={t.update.steps.update}
      description={t.update.updating.description}
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
        {ROWS.map((r, i) => {
          const rs: RowState = i < now ? "done" : i === now ? "active" : "waiting";
          return <CheckRow key={r.phase} label={t.install.installing.rows[r.label]} state={rs} />;
        })}
      </ul>
      <div className="flex flex-col gap-2">
        <Label id="update-label">
          {writing ? t.install.installing.written(formatBytes(written, locale), formatBytes(total, locale), pct) : t.install.installing.verifying}
        </Label>
        <Progress value={writing ? pct : 100} aria-labelledby="update-label" className={writing ? undefined : "animate-pulse"} />
      </div>
      <p className="text-sm text-muted-foreground">{t.install.installing.note}</p>
    </StageCard>
  );
}
