import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { createKeyConnector } from "@/lib/device/create-key-connector";
import type { DeviceCheck } from "@/lib/flashing/machine";
import { policy } from "@/lib/firmware/policy";

/** Read-only: asks the browser for the key, reads its USB strings and landing page, then lets go. */
export function KeyCheck() {
  const [result, setResult] = useState<DeviceCheck | "failed" | null>(null);
  const connector = createKeyConnector();
  if (!connector.supported()) return <p className="text-sm text-muted-foreground">This browser can't check USB devices; use Chrome or Edge.</p>;
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
        <KeyRound aria-hidden /> Check my key
      </Button>
      <div aria-live="polite">
        {result === "failed" && <p className="text-sm">No key was selected or found. Plug it in without holding BOOT and try again.</p>}
        {result && result !== "failed" && (
          <Alert>
            <AlertTitle>Found: {result.productName ?? "unnamed USB device"}</AlertTitle>
            <AlertDescription>Landing page: {result.landingUrl ?? "not checked"}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
