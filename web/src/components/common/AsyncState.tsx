import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The three states of anything that is fetched or filtered: waiting (skeleton rows with a status label), failed (an alert
 * with a retry; the technical message stays English) and empty (a short explanation). Every word is passed in, so the
 * caller's language is the one used.
 */
export type AsyncStateProps =
  | { state: "loading"; label: string; rows?: number }
  | { state: "error"; title: string; message: string; retryLabel: string; onRetry: () => void }
  | { state: "empty"; title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode };

export function AsyncState(props: AsyncStateProps) {
  if (props.state === "loading") {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={props.label}>
        {Array.from({ length: props.rows ?? 2 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full max-w-md" />
        ))}
      </div>
    );
  }
  if (props.state === "error") {
    return (
      <Alert variant="destructive" role="alert">
        <TriangleAlert aria-hidden />
        <AlertTitle>{props.title}</AlertTitle>
        <AlertDescription>
          <div className="flex min-w-0 flex-col items-start gap-3">
            <p lang="en" className="break-words">
              {props.message}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
              {props.retryLabel}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Empty>
      <EmptyHeader>
        {props.icon && <EmptyMedia variant="icon">{props.icon}</EmptyMedia>}
        <EmptyTitle>{props.title}</EmptyTitle>
        {props.description && <EmptyDescription>{props.description}</EmptyDescription>}
      </EmptyHeader>
      {props.action}
    </Empty>
  );
}
