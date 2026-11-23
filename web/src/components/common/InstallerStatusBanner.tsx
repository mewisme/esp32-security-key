import { FlaskConical } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { useI18n } from "@/i18n/context";
import { INSTALLER_HARDWARE_VERIFIED, README_INSTALL_URL } from "@/lib/status";

export function InstallerStatusBanner({ className }: { className?: string }) {
  const { t } = useI18n();
  if (INSTALLER_HARDWARE_VERIFIED) return null;
  return (
    <Alert variant="info" className={className}>
      <FlaskConical aria-hidden />
      <AlertTitle>{t.statusBanner.title}</AlertTitle>
      <AlertDescription>
        <p>
          {t.statusBanner.text(
            <a className="underline underline-offset-4 transition-colors hover:text-primary" href={README_INSTALL_URL} target="_blank" rel="noopener noreferrer">
              {t.statusBanner.link}
            </a>,
          )}
        </p>
      </AlertDescription>
    </Alert>
  );
}
