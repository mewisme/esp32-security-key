import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";
import { createKeyConnector } from "@/lib/device/create-key-connector";
import type { DeviceCheck } from "@/lib/flashing/machine";
import { policy } from "@/lib/firmware/policy";

/** Read-only: asks the browser for the key, reads its USB strings and landing page, then lets go. */
export function KeyCheck() {
  const { t } = useI18n();
  const [result, setResult] = useState<DeviceCheck | "failed" | null>(null);
  const connector = createKeyConnector();
  if (!connector.supported()) return <p className="text-sm text-muted-foreground">{t.device.keyCheck.unsupported}</p>;
  const [vid, pid] = policy.native_usb.app;
  const check = async () => {
    try {
      const conn = await connector.connect(vid, pid);
      try {
        setResult(await conn.identity());
      } finally {
        await conn.close().catch(() => {});
      }
    } catch {
      setResult("failed");
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Button type="button" className="self-start" onClick={() => void check()}>
        <KeyRound aria-hidden /> {t.common.checkMyKey}
      </Button>
      <div aria-live="polite">
        {result === "failed" && <p className="enter-reveal text-sm">{t.device.keyCheck.notFound}</p>}
        {result && result !== "failed" && (
          <Alert className="enter-reveal">
            <AlertTitle>{t.device.keyCheck.found(result.productName ?? t.common.unnamedDevice)}</AlertTitle>
            <AlertDescription>{t.device.keyCheck.landing(result.landingUrl ?? null)}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
