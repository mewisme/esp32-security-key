import { type CSSProperties } from "react";
import { DrawnCheck } from "@/components/common/DrawnCheck";
import { useI18n } from "@/i18n/context";
import { cn } from "cn";

export type KeyVisualState = "idle" | "waiting" | "success" | "failed";

/**
 * The key as the Passkey lab shows it: the board with its BOOT button. While a test waits for a touch the button is
 * ringed (`.pulse-ring-svg`, off under reduced motion, where the thicker outline remains) and a linear countdown runs for
 * the request's timeout; `runId` restarts it. `refuse` is the "don't touch" test, which waits just the same.
 */
export function KeyVisual({
  state,
  timeoutMs,
  runId,
  refuse,
  className,
}: {
  state: KeyVisualState;
  timeoutMs: number;
  runId: number;
  refuse?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const k = t.passkeyLab.keyVisual;
  const waiting = state === "waiting";
  const caption = waiting ? (refuse ? t.passkeyLab.doNotPress : t.passkeyLab.pressBoot) : state === "success" ? k.success : state === "failed" ? k.failed : k.idle;
  const tone = state === "failed" ? "text-destructive" : state === "idle" ? "text-muted-foreground" : "text-primary";
  return (
    <figure className={cn("flex flex-col items-center gap-3", className)} data-testid="key-visual" data-state={state}>
      <div className="relative w-full max-w-60">
        <svg viewBox="0 0 240 200" role="img" aria-labelledby="key-visual-title key-visual-desc" className="h-auto w-full text-foreground">
          <title id="key-visual-title">{k.title}</title>
          <desc id="key-visual-desc">{k.desc}</desc>
          <rect x="40" y="10" width="160" height="180" rx="10" fill="var(--card)" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
          <rect x="62" y="24" width="116" height="70" rx="4" fill="var(--muted)" stroke="currentColor" strokeOpacity="0.5" />
          <text x="120" y="64" textAnchor="middle" fontSize="13" fontFamily="var(--font-mono)" fill="currentColor">
            ESP32-S3
          </text>
          <rect x="142" y="128" width="34" height="22" rx="4" fill="var(--muted)" stroke="currentColor" strokeOpacity="0.5" />
          <circle cx="159" cy="139" r="6" fill="currentColor" fillOpacity="0.35" />
          <text x="159" y="166" textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.7">
            RST
          </text>
          <rect x="102" y="172" width="36" height="24" rx="6" fill="var(--muted)" stroke="currentColor" strokeOpacity="0.5" />
          <g className={tone}>
            <rect
              x="64"
              y="128"
              width="34"
              height="22"
              rx="4"
              fill="currentColor"
              fillOpacity={state === "idle" ? 0.08 : 0.2}
              stroke="currentColor"
              strokeWidth={state === "idle" ? 1.5 : 2.5}
            />
            <circle cx="81" cy="139" r="6" fill="currentColor" />
            {waiting && <rect className="pulse-ring-svg" x="64" y="128" width="34" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />}
            <text x="81" y="166" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor">
              BOOT
            </text>
          </g>
        </svg>
        {state === "success" && (
          <span className="absolute top-1 right-1 flex size-10 items-center justify-center rounded-full bg-success/10 text-success" data-testid="key-visual-check">
            <DrawnCheck ring className="size-7" />
          </span>
        )}
      </div>
      <figcaption className="flex w-full max-w-60 flex-col items-center gap-2 text-sm" role="status">
        <span className={cn("font-medium", waiting && "text-primary", state === "failed" && "text-destructive")}>{caption}</span>
        {waiting && (
          <span key={runId} className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className="countdown block h-full w-full rounded-full bg-primary" style={{ "--countdown-duration": `${timeoutMs / 1000}s` } as CSSProperties} />
          </span>
        )}
      </figcaption>
    </figure>
  );
}
