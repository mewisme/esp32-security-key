import { CircleX, RotateCcw } from "lucide-react";
import { Link } from "react-router";
import { Disclosure } from "@/components/common/Disclosure";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";
import { ERRORS, type ErrorCode } from "@/lib/errors/catalog";
import type { Milestones } from "@/lib/flashing/machine";
import { MilestoneList } from "./MilestoneList";

/**
 * Shows one error. There is deliberately no "continue anyway" action for any error; integrity and storage-safety
 * failures (NO_BYPASS) can only be retried from the start of the connection.
 */
export function ErrorPanel(props: {
  code: ErrorCode;
  message: string;
  log: string[];
  milestones?: Milestones;
  onRetry?: () => void;
  onRestart?: () => void;
}) {
  const { t } = useI18n();
  const info = t.errors[props.code];
  const retry = ERRORS[props.code].retry;
  const showMilestones = props.milestones && (props.milestones.written || props.milestones.flashVerified);
  return (
    <div className="flex flex-col gap-4" data-testid="error-panel" data-error-code={props.code}>
      <Alert variant="destructive">
        <CircleX aria-hidden />
        <AlertTitle>{info.title}</AlertTitle>
        <AlertDescription>
          <p>{info.what}</p>
        </AlertDescription>
      </Alert>
      {showMilestones && <MilestoneList milestones={props.milestones!} />}
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">{t.flasher.whatToDo}</h3>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          {info.next.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {retry && props.onRetry && (
          <Button type="button" onClick={props.onRetry}>
            <RotateCcw aria-hidden /> {t.common.tryAgain}
          </Button>
        )}
        {props.onRestart && (
          <Button type="button" variant="outline" onClick={props.onRestart}>
            {t.common.startOver}
          </Button>
        )}
        <Button asChild variant="link">
          <Link to={`/help#${props.code}`}>{t.common.moreHelp}</Link>
        </Button>
      </div>
      <Disclosure label={t.common.technicalDetails} className="pt-2">
        <pre lang="en" className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {`error: ${props.code}\n${props.message}\n\n${props.log.join("\n")}`}
        </pre>
      </Disclosure>
    </div>
  );
}
