import { LoaderCircle } from "lucide-react";
import { cn } from "cn";

/** The busy icon. It always spins: a spinner is essential progress feedback (WCAG 2.3.3 exempts it), and a pulse read as "frozen". */
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("shrink-0 animate-spin", className)} aria-hidden />;
}
