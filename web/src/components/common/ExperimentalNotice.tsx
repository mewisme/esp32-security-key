import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";

export const EXPERIMENTAL_TEXT = "Experimental development firmware — not suitable for protecting important accounts.";

export function ExperimentalNotice({ className }: { className?: string }) {
  return (
    <Alert variant="warning" className={className}>
      <TriangleAlert aria-hidden />
      <AlertTitle>Experimental</AlertTitle>
      <AlertDescription>{EXPERIMENTAL_TEXT}</AlertDescription>
    </Alert>
  );
}
