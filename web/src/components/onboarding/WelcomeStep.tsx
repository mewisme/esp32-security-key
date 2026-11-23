import { ExperimentalNotice } from "@/components/common/ExperimentalNotice";
import { InstallerStatusBanner } from "@/components/common/InstallerStatusBanner";
import { Button } from "@/components/ui/button";

export function WelcomeStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="space-y-5">
      <p>
        This installer puts the MultiKeys FIDO2 firmware on an ESP32-S3 board so it works as a security key for passkeys and two-step
        sign-in. It takes about five minutes.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>Supported: ESP32-S3 boards with 16 MB flash (for example N16R8) and a BOOT button.</li>
        <li>You need desktop Chrome or Edge and a USB cable that carries data.</li>
        <li>You'll pick your board, connect it in download mode, check the details, and install.</li>
        <li>Nothing is written until you confirm on the summary screen.</li>
      </ul>
      <ExperimentalNotice />
      <InstallerStatusBanner />
      <Button size="lg" onClick={onStart}>
        Start installation
      </Button>
    </div>
  );
}
