import { FlaskConical } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { INSTALLER_HARDWARE_VERIFIED, README_INSTALL_URL } from "@/lib/status";

export function InstallerStatusBanner({ className }: { className?: string }) {
  if (INSTALLER_HARDWARE_VERIFIED) return null;
  return (
    <Alert variant="info" className={className}>
      <FlaskConical aria-hidden />
      <AlertTitle>Not yet tested on real hardware</AlertTitle>
      <AlertDescription>
        <p>
          The web installer has not yet been tested on real hardware. The developer script is the verified method.{" "}
          <a className="underline underline-offset-4" href={README_INSTALL_URL} target="_blank" rel="noopener noreferrer">
            Read the developer instructions
          </a>
          .
        </p>
      </AlertDescription>
    </Alert>
  );
}
