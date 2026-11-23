import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";

export function CatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <TriangleAlert aria-hidden />
      <AlertTitle>The release list couldn't be loaded</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col items-start gap-3">
          <p>{message}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
