import { useEffect, useRef } from "react";
import { HardwareCheckStep } from "@/components/device/HardwareCheckStep";
import { ConnectStep } from "@/components/device/ConnectStep";
import { FirmwareStep } from "@/components/firmware/FirmwareStep";
import { ConfirmStep } from "@/components/flasher/ConfirmStep";
import { ErrorPanel } from "@/components/flasher/ErrorPanel";
import { FirmwareCheckStep } from "@/components/flasher/FirmwareCheckStep";
import { FlashStep } from "@/components/flasher/FlashStep";
import { ReconnectStep } from "@/components/flasher/ReconnectStep";
import { HardwareStep } from "@/components/onboarding/HardwareStep";
import { Stepper } from "@/components/onboarding/Stepper";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { Button } from "@/components/ui/button";
import { isUartBridge, useInstaller } from "@/hooks/useInstaller";
import { STEPS, stepIndex } from "@/lib/wizard-steps";

export function InstallPage() {
  const inst = useInstaller();
  const { state, actions } = inst;
  const { phase } = state;
  const step = stepIndex(phase, state.error?.phase);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [step, phase === "failed"]); // eslint-disable-line react-hooks/exhaustive-deps

  let title: string = STEPS[step] ?? "";
  let body: React.ReactNode = null;
  if (phase === "failed" && state.error) {
    title = "Something went wrong";
    body = (
      <ErrorPanel
        code={state.error.code}
        message={state.error.message}
        log={inst.log}
        milestones={state.milestones}
        onRetry={actions.retry}
        onRestart={() => void actions.reset()}
      />
    );
  } else if (phase === "cancelled") {
    title = "Installation cancelled";
    body = (
      <div className="space-y-4">
        <p>Nothing was written to the board.</p>
        <Button onClick={() => void actions.reset()}>Start over</Button>
      </div>
    );
  } else if (phase === "idle") {
    body = <WelcomeStep onStart={actions.start} />;
  } else if (phase === "checking-browser" || phase === "hardware-guidance") {
    body = <HardwareStep onConfirm={actions.confirmHardware} />;
  } else if (phase === "firmware-selection") {
    body = <FirmwareStep catalog={inst.catalog} defaultRelease={inst.defaultRelease} onReload={inst.loadCatalog} onSelect={actions.selectFirmware} />;
  } else if (phase === "requesting-permission") {
    body = <ConnectStep onChoose={actions.choosePort} />;
  } else if (phase === "connecting" || phase === "detecting-chip" || phase === "validating-compatibility") {
    body = <HardwareCheckStep phase={phase} chip={state.chip} />;
  } else if (phase === "fetching-metadata" || phase === "downloading" || phase === "verifying-integrity" || phase === "checking-flash-safety") {
    body = <FirmwareCheckStep state={state} />;
  } else if (phase === "awaiting-confirmation" && state.decision && inst.selection) {
    body = (
      <ConfirmStep
        decision={state.decision}
        chip={state.chip}
        selection={inst.selection}
        uartPort={isUartBridge(state.port)}
        onConfirm={(acks) => void actions.confirm(acks)}
        onCancel={() => void actions.cancel()}
      />
    );
  } else if (phase === "flashing" || phase === "verifying-flash") {
    body = <FlashStep state={state} />;
  } else if (phase === "rebooting" || phase === "awaiting-reenumeration" || phase === "completed") {
    title = phase === "completed" ? "Installation finished" : title;
    body = <ReconnectStep state={state} onCheck={actions.checkKey} onSkip={actions.skipCheck} />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <Stepper current={step} />
      <section key={`${step}-${phase === "failed"}`} className="step-enter space-y-6" aria-labelledby="step-heading">
        <h1 id="step-heading" ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none sm:text-3xl">
          {title}
        </h1>
        {body}
      </section>
    </div>
  );
}
