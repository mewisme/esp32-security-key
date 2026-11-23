import { Check } from "lucide-react";
import { STEPS } from "@/lib/wizard-steps";
import { cn } from "cn";

export function Stepper({ current }: { current: number }) {
  return (
    <nav aria-label="Installation progress">
      <p className="mb-2 text-sm text-muted-foreground sm:hidden">
        Step {current + 1} of {STEPS.length}: {STEPS[current]}
      </p>
      <ol className="hidden flex-wrap gap-x-1 gap-y-2 sm:flex">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} aria-current={active ? "step" : undefined} className="flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border font-medium transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary",
                  !done && !active && "text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" aria-label="done" /> : i + 1}
              </span>
              <span className={cn("mr-2", active ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
