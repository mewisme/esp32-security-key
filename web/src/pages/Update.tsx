import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ErrorPanel } from "@/components/flasher/ErrorPanel";
import { InstallStepper } from "@/components/installer/InstallStepper";
import { StageCard } from "@/components/installer/StageCard";
import { Page } from "@/components/layout/Page";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { CheckStage } from "@/components/update/CheckStage";
import { InspectStage } from "@/components/update/InspectStage";
import { ReviewStage } from "@/components/update/ReviewStage";
import { UpdateStage } from "@/components/update/UpdateStage";
import { VerifyStage } from "@/components/update/VerifyStage";
import { useUpdater } from "@/hooks/useUpdater";
import { useI18n } from "@/i18n/context";
import { UPDATE_STEPS } from "@/lib/update-steps";

export function UpdatePage() {
  const { t } = useI18n();
  const up = useUpdater();
  const { state, actions, step } = up;
  const index = UPDATE_STEPS.indexOf(step);
  const failed = state.phase === "failed";
  const heading = useRef<HTMLHeadingElement>(null);

  // One stage view per step (and its failure); it enters from the side it was reached from.
  const view = `${step}-${failed}-${state.phase === "awaiting-boot" || state.phase === "choosing" || state.phase === "reviewed"}`;
  const [shown, setShown] = useState({ view, index });
  const [direction, setDirection] = useState<"forward" | "back" | "swap" | null>(null);
  if (view !== shown.view) {
    setShown({ view, index });
    setDirection(index > shown.index ? "forward" : index < shown.index ? "back" : "swap");
  }

  useEffect(() => {
    heading.current?.focus();
  }, [step, failed]);

  let stage: React.ReactNode;
  if (failed && state.error) {
    const wrote = state.failedAt === "updating" || state.failedAt === "rebooting";
    stage = (
      <StageCard title={t.update.steps[step]} headingRef={heading}>
        <ErrorPanel
          code={state.error.code}
          message={state.error.message}
          log={state.log}
          onRetry={actions.toReview}
          onRestart={() => void actions.reset()}
        />
        {wrote && (
          <Alert variant="warning" data-testid="update-recovery">
            <TriangleAlert aria-hidden />
            <AlertTitle>{t.update.failed.recoveryTitle}</AlertTitle>
            <AlertDescription>{t.update.failed.recoveryText}</AlertDescription>
          </Alert>
        )}
      </StageCard>
    );
  } else if (step === "connect") {
    stage = <InspectStage up={up} headingRef={heading} />;
  } else if (step === "check") {
    stage = <CheckStage up={up} headingRef={heading} />;
  } else if (step === "review") {
    stage = <ReviewStage up={up} headingRef={heading} />;
  } else if (step === "update") {
    stage = <UpdateStage up={up} headingRef={heading} />;
  } else {
    stage = <VerifyStage up={up} headingRef={heading} />;
  }

  return (
    <Page width="flow">
      <PageHeader title={t.update.title} description={t.update.lead} />
      <InstallStepper stage={index} steps={UPDATE_STEPS} titles={t.update.steps} text={t.update.stepper} />
      <section key={view} className={direction ? "enter-stage" : undefined} data-direction={direction ?? undefined} aria-labelledby="step-heading">
        {stage}
      </section>
    </Page>
  );
}
