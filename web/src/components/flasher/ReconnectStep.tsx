import { ArrowRight, CircleCheck, KeyRound, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FlashState } from "@/lib/flashing/machine";
import { ERRORS } from "@/lib/errors/catalog";
import { MilestoneList } from "./MilestoneList";

export function ReconnectStep(props: { state: FlashState; onCheck: () => Promise<void>; onSkip: () => void }) {
  const { state } = props;
  const [busy, setBusy] = useState(false);
  const done = state.phase === "completed";
  return (
    <div className="space-y-6">
      <MilestoneList milestones={state.milestones} />
      {!done && (
        <>
          <div className="space-y-2">
            <p>
              The board is restarting with MultiKeys. Its serial port disappears and it appears as a security key instead; that is
              expected. If nothing happens within a few seconds, unplug the board and plug it back in without holding BOOT.
            </p>
            <p className="text-sm text-muted-foreground">
              “Check my key” asks the browser to show the key; pick “MultiKeys Security Key”. This only reads its name.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              disabled={busy || state.phase !== "awaiting-reenumeration"}
              onClick={() => {
                setBusy(true);
                void props.onCheck().finally(() => setBusy(false));
              }}
            >
              <KeyRound aria-hidden /> Check my key
            </Button>
            <Button size="lg" variant="outline" disabled={state.phase !== "awaiting-reenumeration"} onClick={props.onSkip}>
              Skip this check
            </Button>
          </div>
        </>
      )}
      {done && state.milestones.deviceDetected && state.device && (
        <Alert>
          <CircleCheck className="text-success" aria-hidden />
          <AlertTitle>Key detected: {state.device.productName ?? "unnamed USB device"}</AlertTitle>
          <AlertDescription>
            <p>
              Landing page:{" "}
              {state.device.landingUrl ?? "not checked (the browser couldn't read it; that is common on Windows and harmless)"}
            </p>
          </AlertDescription>
        </Alert>
      )}
      {done && !state.milestones.deviceDetected && (
        <Alert>
          <TriangleAlert className="text-warning" aria-hidden />
          <AlertTitle>Flash verified; running key not checked</AlertTitle>
          <AlertDescription>
            <p>Firmware written and verified; key not yet detected.</p>
            <ul className="list-disc pl-5">
              {ERRORS["no-reenumeration"].next.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {done && (
        <Button asChild size="lg">
          <Link to="/first-use">
            First use <ArrowRight aria-hidden />
          </Link>
        </Button>
      )}
    </div>
  );
}
