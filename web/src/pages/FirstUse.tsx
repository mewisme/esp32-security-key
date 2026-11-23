import { KeyRound } from "lucide-react";
import { useState } from "react";
import { ExperimentalNotice } from "@/components/common/ExperimentalNotice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createUsbChecker } from "@/lib/device/create-usb-checker";
import type { DeviceCheck } from "@/lib/flashing/machine";
import { policy } from "@/lib/firmware/policy";
import { REPO_URL } from "@/lib/status";

const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "after-install",
    title: "Right after installing",
    body: (
      <>
        <p>
          The serial (COM) port you used for installing disappears. That is normal: the board now presents itself as a security key (USB
          names: “MultiKeys Security Key”) instead of an installer port. To install again later, use download mode (hold BOOT while
          plugging in).
        </p>
      </>
    ),
  },
  {
    id: "touch",
    title: "The BOOT button is the touch button",
    body: (
      <p>
        When a website or your browser asks you to touch your security key, press the BOOT button once. There is no status light on
        this firmware, so watch the browser's prompt instead.
      </p>
    ),
  },
  {
    id: "register",
    title: "Registering vs. signing in",
    body: (
      <p>
        First add the key to an account (often under Security → Passkeys or Two-step verification → Security key). Later, when you sign
        in, the site asks for the key again and you press BOOT. Use a test account first: this is experimental firmware.
      </p>
    ),
  },
  {
    id: "pin",
    title: "Why a site may ask for a PIN",
    body: (
      <>
        <p>
          Pressing BOOT proves someone is present. Some sites also want proof that it is <em>you</em>, which this key does with a PIN.
          The first time a site needs it, your browser offers to set one.
        </p>
        <p>
          Once a PIN is set, it can only be removed by resetting the key, which deletes every stored credential. Read{" "}
          <a className="underline underline-offset-4" href={`${REPO_URL}/blob/main/docs/FIDO_UV.md`} target="_blank" rel="noreferrer">
            how the PIN works
          </a>{" "}
          before setting one.
        </p>
      </>
    ),
  },
  {
    id: "check",
    title: "Checking the key without changing anything",
    body: (
      <p>
        Use the button below, or the{" "}
        <a className="underline underline-offset-4" href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
          host tools
        </a>
        : <code className="font-mono">multikey device info</code> or <code className="font-mono">multikey fido info</code> (on
        Windows from an Administrator terminal). Both only read information.
      </p>
    ),
  },
  {
    id: "recovery",
    title: "Recovery",
    body: (
      <p>
        If the key stops responding, put the board in download mode (unplug, hold BOOT, plug in, release) and run the installer again.
        It detects the existing MultiKeys installation and doesn't write the area that holds your keys.
      </p>
    ),
  },
];

function KeyCheck() {
  const [result, setResult] = useState<DeviceCheck | null | "failed">(null);
  const checker = createUsbChecker();
  if (!checker.supported()) return <p className="text-sm text-muted-foreground">This browser can't check USB devices; use Chrome or Edge.</p>;
  const [vid, pid] = policy.native_usb.app;
  return (
    <div className="space-y-3">
      <Button
        onClick={() =>
          checker
            .check(vid, pid)
            .then(setResult)
            .catch(() => setResult("failed"))
        }
      >
        <KeyRound aria-hidden /> Check my key
      </Button>
      {result === "failed" && <p className="text-sm">No key was selected or found. Plug it in without holding BOOT and try again.</p>}
      {result && result !== "failed" && (
        <Alert>
          <AlertTitle>Found: {result.productName ?? "unnamed USB device"}</AlertTitle>
          <AlertDescription>Landing page: {result.landingUrl ?? "not checked"}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function FirstUsePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <h1 className="text-3xl font-semibold">First use</h1>
      <ExperimentalNotice />
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="space-y-2" aria-labelledby={`${s.id}-h`}>
          <h2 id={`${s.id}-h`} className="text-xl font-semibold">
            {s.title}
          </h2>
          <div className="space-y-2 text-muted-foreground">{s.body}</div>
          {s.id === "check" && <KeyCheck />}
        </section>
      ))}
    </div>
  );
}
