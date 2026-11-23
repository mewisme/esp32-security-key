import { useEffect, useRef } from "react";
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
import { STEPS, stepIndex } from "@/lib/wizard-steps";

export function InstallPage() {
  const inst = useInstaller();
  const { state, actions } = inst;
  const { phase } = state;
  const step = stepIndex(phase, state.error?.phase);
  const heading = useRef<HTMLHeadingElement>(null);

  // Move focus to the stage heading whenever the stage (or the failed state) changes.
  useEffect(() => {
    heading.current?.focus();
  }, [step, phase === "failed"]); // eslint-disable-line react-hooks/exhaustive-deps

  let stage: React.ReactNode;
  if (phase === "failed" && state.error) {
    stage = (
      <StageCard title={STEPS[step] ?? "Install"} headingRef={heading}>
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
        title="Installation cancelled"
        description="Nothing was written to the board."
        headingRef={heading}
        primary={
          <Button type="button" onClick={() => void actions.reset()}>
            Start over
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
        <h1 className="text-2xl font-semibold sm:text-3xl">Install MultiKeys</h1>
        <p className="text-muted-foreground">Put the MultiKeys FIDO2 firmware on an ESP32-S3 board, straight from your browser.</p>
      </header>
      <InstallStepper stage={step} />
      <section key={`${step}-${phase === "failed"}`} className="step-enter" aria-labelledby="step-heading">
        {stage}
      </section>
    </Page>
  );
}
