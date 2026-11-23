import { useState } from "react";
import { DeviceNameField } from "@/components/device/DeviceNameField";
import { NameResult } from "@/components/device/NameResult";
import { Button } from "@/components/ui/button";
import { useKeyName } from "@/hooks/useKeyName";
import { useI18n } from "@/i18n/context";
import { createKeyConnector } from "@/lib/device/create-key-connector";
import { FALLBACK_DEFAULT_NAME, validateDeviceName } from "@/lib/device/device-name";
import type { NameRequest } from "@/lib/device/mkauth";
import { policy } from "@/lib/firmware/policy";
import { loadConfig } from "@/lib/installer-config";

function initialName(): string {
  const { name } = loadConfig();
  return name.mode === "custom" ? name.name : "";
}

/** Renames a key that is already running MultiKeys: custom name or reset to the default; the BOOT press happens on the key. */
export function RenameKey() {
  const { t } = useI18n();
  const [text, setText] = useState(initialName);
  const [last, setLast] = useState<NameRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const keyName = useKeyName();
  const invalid = validateDeviceName(text) !== null;

  const run = async (request: NameRequest) => {
    setLast(request);
    setBusy(true);
    try {
      const connector = createKeyConnector();
      if (!connector.supported()) {
        keyName.fail("name-transport-unavailable", "WebUSB is not available in this browser");
        return;
      }
      const [vid, pid] = policy.native_usb.app;
      let conn;
      try {
        conn = await connector.connect(vid, pid);
      } catch (e) {
        keyName.fail("name-transport-unavailable", e instanceof Error ? e.message : String(e));
        return;
      }
      await keyName.apply(conn, request, FALLBACK_DEFAULT_NAME);
    } finally {
      setBusy(false);
    }
  };

  const custom = (): NameRequest => ({ mode: "custom", name: text });
  const retry = () => void run(last ?? custom());

  return (
    <div className="flex flex-col gap-4">
      <DeviceNameField value={text} onChange={setText} defaultName={FALLBACK_DEFAULT_NAME} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={invalid || busy} onClick={() => void run(custom())}>
          {t.device.renameKey.apply}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void run({ mode: "default" })}>
          {t.device.renameKey.reset}
        </Button>
      </div>
      {last && (
        <NameResult name={keyName.name} request={last} defaultName={FALLBACK_DEFAULT_NAME} onSubmitPin={keyName.submitPin} onRetry={retry} />
      )}
    </div>
  );
}
