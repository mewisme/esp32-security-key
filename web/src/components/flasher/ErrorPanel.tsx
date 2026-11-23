import { ChevronDown, CircleX, RotateCcw } from "lucide-react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  const info = ERRORS[props.code];
  const showMilestones = props.milestones && (props.milestones.written || props.milestones.flashVerified);
  return (
    <div className="space-y-5" data-testid="error-panel" data-error-code={props.code}>
      <Alert variant="destructive">
        <CircleX aria-hidden />
        <AlertTitle>{info.title}</AlertTitle>
        <AlertDescription>
          <p>{info.what}</p>
        </AlertDescription>
      </Alert>
      {showMilestones && <MilestoneList milestones={props.milestones!} />}
      <div>
        <h3 className="mb-2 font-medium">What to do</h3>
        <ol className="list-decimal space-y-1 pl-5">
          {info.next.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ol>
      </div>
      <div className="flex flex-wrap gap-3">
        {info.retry && props.onRetry && (
          <Button onClick={props.onRetry}>
            <RotateCcw aria-hidden /> Try again
          </Button>
        )}
        {props.onRestart && (
          <Button variant="outline" onClick={props.onRestart}>
            Start over
          </Button>
        )}
        <Button asChild variant="link">
          <Link to={`/help#${props.code}`}>More help</Link>
        </Button>
      </div>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1">
            Technical details <ChevronDown className="size-4" aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {`error: ${props.code}\n${props.message}\n\n${props.log.join("\n")}`}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
