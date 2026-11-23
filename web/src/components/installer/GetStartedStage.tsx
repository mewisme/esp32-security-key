import { useId, useState } from "react";
import { Disclosure } from "@/components/common/Disclosure";
import { ExperimentalNotice } from "@/components/common/ExperimentalNotice";
import { InstallerStatusBanner } from "@/components/common/InstallerStatusBanner";
import { BoardDiagram } from "@/components/hardware/BoardDiagram";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import type { Installer } from "@/hooks/useInstaller";
import { useI18n } from "@/i18n/context";
import { StageCard } from "./StageCard";

const FACTS = ["whatHappens", "whatYouNeed", "beforeConfirm"] as const;

export function GetStartedStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t } = useI18n();
  const [ok, setOk] = useState(false);
  const id = useId();
  return (
    <StageCard
      title={t.install.steps["get-started"]}
      description={t.install.getStarted.description}
      headingRef={headingRef}
      primary={
        <Button type="button" disabled={!ok || inst.state.phase === "checking-browser"} onClick={() => inst.actions.begin()}>
          {t.common.continue}
        </Button>
      }
    >
      <ul className="flex flex-col gap-3">
        {FACTS.map((key) => (
          <li key={key} className="flex flex-col gap-1">
            <span className="font-medium">{t.install.getStarted[key].title}</span>
            <span className="text-muted-foreground">{t.install.getStarted[key].text}</span>
          </li>
        ))}
      </ul>
      <ExperimentalNotice />
      <InstallerStatusBanner />
      <BoardDiagram caption={t.install.getStarted.boardCaption} />
      <Disclosure label={t.install.getStarted.unsure} className="pt-2 text-sm text-muted-foreground">
        {t.install.getStarted.unsureText}
      </Disclosure>
      <Field orientation="horizontal">
        <Checkbox id={id} checked={ok} onCheckedChange={(v) => setOk(v === true)} />
        <Label htmlFor={id}>{t.install.getStarted.hardwareCheck}</Label>
      </Field>
    </StageCard>
  );
}
