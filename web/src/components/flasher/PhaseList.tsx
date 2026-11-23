import { CircleCheck, CircleDashed, LoaderCircle } from "lucide-react";
import { PHASES, type Phase } from "@/lib/flashing/machine";
import { cn } from "cn";

/** Live checklist for a group of phases: done / in progress / waiting, as icon plus text. */
export function PhaseList({ items, current }: { items: { phase: Phase; label: string }[]; current: Phase }) {
  const now = PHASES.indexOf(current);
  return (
    <ul className="space-y-2" aria-live="polite">
      {items.map((it) => {
        const idx = PHASES.indexOf(it.phase);
        const state = idx < now ? "done" : idx === now ? "active" : "waiting";
        const Icon = state === "done" ? CircleCheck : state === "active" ? LoaderCircle : CircleDashed;
        return (
          <li key={it.phase} className={cn("flex items-center gap-2", state === "waiting" && "text-muted-foreground")}>
            <Icon className={cn("size-4", state === "done" && "text-success", state === "active" && "animate-spin text-primary")} aria-hidden />
            <span>{it.label}</span>
            <span className="sr-only">({state === "done" ? "done" : state === "active" ? "in progress" : "waiting"})</span>
          </li>
        );
      })}
    </ul>
  );
}
