import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { ExperimentalNotice } from "@/components/common/ExperimentalNotice";
import { InstallerStatusBanner } from "@/components/common/InstallerStatusBanner";
import { BoardDiagram } from "@/components/hardware/BoardDiagram";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import type { Installer } from "@/hooks/useInstaller";
import { supportedFlashSizes } from "@/lib/firmware/policy";
import { StageCard } from "./StageCard";

const CAPTION =
  "Example: an N16R8 module. The number after N is the flash size in MB; N4, N8 and N16 are supported.";

export function GetStartedStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const [ok, setOk] = useState(false);
  const id = useId();
  const sizes = supportedFlashSizes()
    .map((s) => s.replace("MB", ""))
    .join(", ");
  const facts = [
    {
      title: "What happens",
      text: "You pick the firmware, put the board in download mode, check what the installer found, and install. Afterwards you can give the key its own name.",
    },
    {
      title: "What you need",
      text: `An ESP32-S3 board with ${sizes.replace(/, (\d+)$/, " or $1")} MB of quad-SPI flash, a native USB connector, a BOOT button, a USB cable that carries data, and desktop Chrome or Edge.`,
    },
    {
      title: "Before you confirm",
      text: "Nothing is written to the board until you confirm on the Review screen.",
    },
  ];
  return (
    <StageCard
      title="Get started"
      description="Install the MultiKeys FIDO2 firmware on an ESP32-S3 board. It takes about five minutes."
      headingRef={headingRef}
      primary={
        <Button type="button" disabled={!ok || inst.state.phase === "checking-browser"} onClick={() => inst.actions.begin()}>
          Continue
        </Button>
      }
    >
      <ul className="flex flex-col gap-3">
        {facts.map((f) => (
          <li key={f.title} className="flex flex-col gap-1">
            <span className="font-medium">{f.title}</span>
            <span className="text-muted-foreground">{f.text}</span>
          </li>
        ))}
      </ul>
      <ExperimentalNotice />
      <InstallerStatusBanner />
      <BoardDiagram caption={CAPTION} />
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            Not sure which board you have? <ChevronDown aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 text-sm text-muted-foreground">
          You don't have to know. The Connect &amp; verify stage reads the chip and the flash size electronically and stops, before
          writing anything, if the board isn't supported. The marking on the metal module (for example N8R2) tells you the flash size
          too: the number after N.
        </CollapsibleContent>
      </Collapsible>
      <Field orientation="horizontal">
        <Checkbox id={id} checked={ok} onCheckedChange={(v) => setOk(v === true)} />
        <Label htmlFor={id}>My board is an ESP32-S3 with a native USB connector and a BOOT button</Label>
      </Field>
    </StageCard>
  );
}
