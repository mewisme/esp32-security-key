import { Spinner } from "@/components/common/Spinner";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/context";
import type { TestId } from "@/lib/passkey/tests";

export type CardStatus = "idle" | "waiting" | "passed" | "failed";

const VARIANT = { idle: "outline", waiting: "info-light", passed: "success-light", failed: "destructive-light" } as const;

/**
 * One test of the track: number, title, one line of explanation, its status and the button that runs it. `locked` means the
 * test needs a registered passkey; `busy` means another test is running (only one runs at a time).
 */
export function TestCard({
  id,
  n,
  icon,
  status,
  hasRun,
  locked,
  busy,
  onRun,
}: {
  id: TestId;
  n: number;
  icon: React.ReactNode;
  status: CardStatus;
  /** A result exists (so the button offers to run again, even while the new run waits). */
  hasRun: boolean;
  locked: boolean;
  busy: boolean;
  onRun: () => void;
}) {
  const { t } = useI18n();
  const p = t.passkeyLab;
  const test = p.tests[id];
  const label = {
    idle: p.status.notRun,
    waiting: id === "refusal" ? p.status.waitingRefusal : p.status.waiting,
    passed: p.status.passed,
    failed: p.status.failed,
  }[status];
  const action = hasRun ? p.runAgain : p.run;
  return (
    <Card data-testid={`test-${id}`} data-status={status}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums" aria-hidden="true">
            {n}
          </span>
          <span className="text-muted-foreground [&_svg]:size-4" aria-hidden="true">
            {icon}
          </span>
          {test.title}
        </CardTitle>
        <CardAction>
          <span aria-live="polite">
            <Badge variant={VARIANT[status]} size="lg" data-testid={`status-${id}`}>
              {status === "waiting" && <Spinner className="size-3" />}
              {label}
            </Badge>
          </span>
        </CardAction>
        <CardDescription>{test.text}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button type="button" variant={status === "idle" ? "default" : "outline"} disabled={locked || busy} onClick={onRun} aria-label={`${action}: ${test.title}`}>
          {action}
        </Button>
        {locked && <span className="text-xs text-muted-foreground">{p.needsRegister}</span>}
      </CardContent>
    </Card>
  );
}
