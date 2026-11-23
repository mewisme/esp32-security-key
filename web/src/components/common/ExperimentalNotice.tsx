import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { useI18n } from "@/i18n/context";

export function ExperimentalNotice({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <Alert variant="warning" className={className}>
      <TriangleAlert aria-hidden />
      <AlertTitle>{t.experimental.title}</AlertTitle>
      <AlertDescription>{t.experimental.text}</AlertDescription>
    </Alert>
  );
}
