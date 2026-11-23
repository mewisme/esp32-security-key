import { ChevronDown, Usb } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ERRORS } from "@/lib/errors/catalog";

const SEQUENCE = [
  "Unplug the board from the computer.",
  "Press and hold the BOOT button.",
  "While holding BOOT, plug the board into the computer using the connector labelled USB or OTG.",
  "Let go of BOOT.",
  "Click “Choose device” below and pick “USB JTAG/serial debug unit” or an entry that mentions ESP32-S3, then click Connect.",
];

export function ConnectStep({ onChoose }: { onChoose: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-5">
      <p>Put the board in download mode so it can receive new firmware:</p>
      <ol className="space-y-3">
        {SEQUENCE.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-medium text-primary">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">
        Board with an RST button? You can also keep it plugged in: hold BOOT, press and release RST, then release BOOT.
      </p>
      <Button
        size="lg"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onChoose().finally(() => setBusy(false));
        }}
      >
        <Usb aria-hidden /> Choose device
      </Button>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1">
            The board isn't in the list <ChevronDown className="size-4" aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2 text-sm">
          {(["power-only-cable", "wrong-connector", "multiple-devices"] as const).map((c) => (
            <div key={c}>
              <p className="font-medium">{ERRORS[c].title}</p>
              <p className="text-muted-foreground">{ERRORS[c].what}</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {ERRORS[c].next.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
