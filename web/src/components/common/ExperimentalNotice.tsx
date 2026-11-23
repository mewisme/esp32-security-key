import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const EXPERIMENTAL_TEXT = "Experimental development firmware — not suitable for protecting important accounts.";

export function ExperimentalNotice({ className }: { className?: string }) {
  return (
    <Alert className={className}>
      <TriangleAlert className="text-warning" aria-hidden />
      <AlertTitle>Experimental</AlertTitle>
      <AlertDescription>{EXPERIMENTAL_TEXT}</AlertDescription>
    </Alert>
  );
}
