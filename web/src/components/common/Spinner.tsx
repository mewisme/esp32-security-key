import { LoaderCircle } from "lucide-react";
import { cn } from "cn";

/** The busy icon. It spins; under reduced motion it pulses instead, so work in progress still looks alive. */
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("shrink-0 motion-safe:animate-spin motion-reduce:animate-pulse", className)} aria-hidden />;
}
