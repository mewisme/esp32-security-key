import { CheckIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper";
import { STEPS } from "@/lib/wizard-steps";

// Check mark drawn at the design's 1.4px line weight (3.36 on a 24-unit grid); stroke-[3.36] wins over the svg attribute.
const completed = <CheckIcon strokeWidth={3.36} className="size-2.5 stroke-[3.36]" aria-hidden="true" />;

// pathLength counts the circle as 28 units, so the 3:1 dash pattern closes in seven even dashes.
function DashedRing() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-4">
      <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 1" pathLength={28} />
    </svg>
  );
}

const indicators = { completed, inactive: <DashedRing />, active: <DashedRing /> };

/** The six installation stages. Display only: nothing here navigates, the installer state decides the stage. */
export function InstallStepper({ stage }: { stage: number }) {
  const rowRef = useRef<HTMLDivElement>(null);

  // If the row is wider than its box it scrolls (only the row, never the page); keep the current step in view.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const reveal = () => {
      const tab = row.querySelector('[aria-selected="true"]');
      if (!tab) return;
      const box = row.getBoundingClientRect();
      const { left, right } = tab.getBoundingClientRect();
      if (left < box.left || right > box.right) row.scrollLeft += (left + right - box.left - box.right) / 2;
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(row);
    reveal();
    return () => observer.disconnect();
  }, [stage]);

  return (
    <div className="flex flex-col gap-2">
      <Stepper value={stage + 1} indicators={indicators} aria-label="Installation progress">
        <div ref={rowRef} className="@container relative -mx-1 -my-2 overflow-x-auto p-2">
          <StepperNav className="min-w-max gap-1">
            {STEPS.map((title, i) => (
              <StepperItem key={title} step={i + 1} completed={i < stage} className="gap-1.5">
                <StepperTrigger disabled className="-m-1 gap-1.5 p-1 disabled:opacity-100">
                  <StepperIndicator className="size-4 bg-ring/20 text-ring/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground" />
                  <StepperTitle className="whitespace-nowrap data-[state=inactive]:text-muted-foreground @max-2xl:not-data-[state=active]:sr-only">
                    {title}
                  </StepperTitle>
                  {i < stage && <span className="sr-only">, completed</span>}
                </StepperTrigger>
                {i < STEPS.length - 1 && (
                  <StepperSeparator className="m-0 min-w-6 bg-transparent bg-linear-to-r from-primary to-ring/20 data-[state=completed]:to-primary data-[state=inactive]:from-ring/20 rtl:bg-linear-to-l" />
                )}
              </StepperItem>
            ))}
          </StepperNav>
        </div>
      </Stepper>
      <p className="text-xs text-muted-foreground tabular-nums">
        Step {stage + 1} of {STEPS.length}
      </p>
    </div>
  );
}
