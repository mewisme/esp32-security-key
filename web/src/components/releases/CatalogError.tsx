import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";

export function CatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Alert variant="destructive" role="alert">
      <TriangleAlert aria-hidden />
      <AlertTitle>{t.releases.loadFailed}</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col items-start gap-3">
          <p lang="en">{message}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t.common.retry}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
