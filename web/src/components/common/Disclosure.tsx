import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "cn";

/**
 * A ghost button that opens a block below it. The click starts the only height animation on the site (`.collapse-content`,
 * 200 ms, instant under reduced motion) and turns the chevron, which keeps turning under reduced motion.
 */
export function Disclosure({ label, className, children }: { label: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {label}{" "}
          <ChevronDown
            aria-hidden
            className="transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-aria-expanded/button:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn("collapse-content", className)}>{children}</CollapsibleContent>
    </Collapsible>
  );
}
