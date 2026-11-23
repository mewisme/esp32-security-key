import { useEffect, useRef, useState } from "react";
import { ErrorPanel } from "@/components/flasher/ErrorPanel";
import { ConnectVerifyStage } from "@/components/installer/ConnectVerifyStage";
import { FinishStage } from "@/components/installer/FinishStage";
import { FirmwareStage } from "@/components/installer/FirmwareStage";
import { GetStartedStage } from "@/components/installer/GetStartedStage";
import { InstallStage } from "@/components/installer/InstallStage";
import { InstallStepper } from "@/components/installer/InstallStepper";
import { ReviewStage } from "@/components/installer/ReviewStage";
import { StageCard } from "@/components/installer/StageCard";
import { Page } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { useInstaller } from "@/hooks/useInstaller";
import { useI18n } from "@/i18n/context";
import { STEPS, stepIndex } from "@/lib/wizard-steps";

export function InstallPage() {
  const { t } = useI18n();
  const inst = useInstaller();
  const { state, actions } = inst;
  const { phase } = state;
  const step = stepIndex(phase, state.error?.phase);
  const heading = useRef<HTMLHeadingElement>(null);

  // One stage view per key: a step, its failure, or (in Connect & verify) the device chooser before the checks. The stage
  // enters from the side it was reached from; the first view rides on the page's own entrance.
  const view = `${step}-${phase === "failed"}-${phase === "requesting-permission"}`;
  const [shown, setShown] = useState({ view, step });
  const [direction, setDirection] = useState<"forward" | "back" | "swap" | null>(null);
  if (view !== shown.view) {
    setShown({ view, step });
    setDirection(step > shown.step ? "forward" : step < shown.step ? "back" : "swap");
  }

  // Move focus to the stage heading whenever the stage (or the failed state) changes.
  useEffect(() => {
    heading.current?.focus();
  }, [step, phase === "failed"]); // eslint-disable-line react-hooks/exhaustive-deps

  let stage: React.ReactNode;
  if (phase === "failed" && state.error) {
    stage = (
      <StageCard title={t.install.steps[STEPS[step] ?? "install"]} headingRef={heading}>
        <ErrorPanel
          code={state.error.code}
          message={state.error.message}
          log={inst.log}
          milestones={state.milestones}
          onRetry={actions.retry}
          onRestart={() => void actions.reset()}
        />
      </StageCard>
    );
  } else if (phase === "cancelled") {
    stage = (
      <StageCard
        title={t.install.cancelled.title}
        description={t.install.cancelled.text}
        headingRef={heading}
        primary={
          <Button type="button" onClick={() => void actions.reset()}>
            {t.common.startOver}
          </Button>
        }
      />
    );
  } else if (step === 0) {
    stage = <GetStartedStage inst={inst} headingRef={heading} />;
  } else if (step === 1) {
    stage = <FirmwareStage inst={inst} headingRef={heading} />;
  } else if (step === 2) {
    stage = <ConnectVerifyStage inst={inst} headingRef={heading} />;
  } else if (step === 3) {
    stage = <ReviewStage inst={inst} headingRef={heading} />;
  } else if (step === 4) {
    stage = <InstallStage inst={inst} headingRef={heading} />;
  } else {
    stage = <FinishStage inst={inst} headingRef={heading} />;
  }

  return (
    <Page width="flow">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold sm:text-3xl">{t.install.title}</h1>
        <p className="text-muted-foreground">{t.install.lead}</p>
      </header>
      <InstallStepper stage={step} />
      <section key={view} className={direction ? "enter-stage" : undefined} data-direction={direction ?? undefined} aria-labelledby="step-heading">
        {stage}
      </section>
    </Page>
  );
}
