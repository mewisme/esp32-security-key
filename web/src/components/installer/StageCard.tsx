import { CircleDashed } from "lucide-react";
import type { Ref } from "react";
import { DrawnCheck } from "@/components/common/DrawnCheck";
import { Spinner } from "@/components/common/Spinner";
import { Badge } from "@/components/reui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/context";
import type { Support } from "@/lib/compatibility/profiles";
import { cn } from "cn";

/**
 * The one centred Card every installer stage lives in: heading (focus target, see pages/Install.tsx), description,
 * body, and a footer with the secondary action on the left and the primary one on the right.
 */
export function StageCard({
  title,
  description,
  headingRef,
  secondary,
  primary,
  children,
}: {
  title: string;
  description?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  secondary?: React.ReactNode;
  primary?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const hasFooter = secondary || primary;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="step-heading" ref={headingRef} tabIndex={-1} className="scroll-mt-24 outline-none">
            {title}
          </h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children && <CardContent className="flex flex-col gap-6">{children}</CardContent>}
      {hasFooter && (
        <CardFooter className="justify-between gap-2">
          <div className="flex items-center gap-2">{secondary}</div>
          <div className="flex items-center gap-2">{primary}</div>
        </CardFooter>
      )}
    </Card>
  );
}

export type RowState = "done" | "active" | "waiting";

/**
 * One line of a live checklist: leading status icon, label, right-aligned value. The check draws itself when a row
 * completes, a value fades in when it arrives, and a row's `below` (a progress bar) fades in when it appears.
 */
export function CheckRow(props: { label: string; state: RowState; children?: React.ReactNode; below?: React.ReactNode }) {
  const { state } = props;
  const { t } = useI18n();
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className={cn("flex items-center gap-2", state === "waiting" && "text-muted-foreground")}>
          {state === "done" ? (
            <DrawnCheck ring className="size-4 text-success-foreground dark:text-success" />
          ) : state === "active" ? (
            <Spinner className="size-4 text-primary" />
          ) : (
            <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          {props.label}
          <span className="sr-only">({t.install.rowState[state]})</span>
        </span>
        <span className="min-w-0 text-right text-sm text-muted-foreground">
          {props.children ? <span className="enter-reveal block">{props.children}</span> : null}
        </span>
      </div>
      {props.below ? <div className="enter-reveal">{props.below}</div> : null}
    </li>
  );
}

const SUPPORT_BADGE = {
  "hardware-verified": "success-light",
  "expected-compatible": "info-light",
  "build-verified": "warning-light",
} as const satisfies Record<Support, string>;

/** How well the connected board is known to work: one state badge, text from the compatibility module. */
export function CompatibilityBadge({ support, verifiedAs }: { support: Support; verifiedAs: string | null }) {
  const { t } = useI18n();
  const text = support === "hardware-verified" ? `${t.support[support]} (${verifiedAs ?? "ESP32-S3 N16R8"})` : t.support[support];
  // The text is longer than a phone's row: let it wrap instead of being cut off.
  return (
    <Badge variant={SUPPORT_BADGE[support]} className="h-auto min-h-5 text-left whitespace-normal">
      {text}
    </Badge>
  );
}
