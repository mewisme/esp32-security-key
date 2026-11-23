import { Cpu, KeyRound, type LucideIcon, Tag } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { NameResult } from "@/components/device/NameResult";
import { MilestoneList } from "@/components/flasher/MilestoneList";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useChangedSinceMount } from "@/hooks/useChangedSinceMount";
import type { Installer } from "@/hooks/useInstaller";
import { useI18n } from "@/i18n/context";
import { FALLBACK_DEFAULT_NAME } from "@/lib/device/device-name";
import { cn } from "cn";
import { StageCard } from "./StageCard";

function ResultRow(props: { icon: LucideIcon; title: string; badge?: React.ReactNode; children?: React.ReactNode }) {
  const Icon = props.icon;
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">{props.title}</h3>
          {props.badge}
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function FinishStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t } = useI18n();
  const { state, actions, name, selection } = inst;
  const [busy, setBusy] = useState(false);
  const done = state.phase === "completed";
  const waiting = state.phase === "awaiting-reenumeration";
  const detected = done && state.milestones.deviceDetected && state.device;
  const shownName = name.applied ?? state.device?.productName ?? t.common.unnamedDevice;
  // The outcome of the key check replaces the replug instructions; instructions that are already there ride on the stage.
  const resolved = useChangedSinceMount(done) ? "enter-reveal" : undefined;
  const openpgp = selection?.build.image === "openpgp";

  return (
    <StageCard
      title={t.install.steps.finish}
      description={done ? t.install.finish.doneDescription : t.install.finish.writtenDescription}
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={() => void actions.reset()}>
          {t.common.startOver}
        </Button>
      }
      primary={
        done ? (
          <Button asChild>
            <Link to="/first-use">{t.install.finish.firstUse}</Link>
          </Button>
        ) : undefined
      }
    >
      <ResultRow
        icon={Cpu}
        title={t.common.firmware}
        badge={
          state.milestones.flashVerified ? (
            <Badge variant="success-light">{t.install.finish.firmware.verified}</Badge>
          ) : (
            <Badge variant="outline">{t.install.finish.firmware.notVerified}</Badge>
          )
        }
      >
        {selection && (
          <p className="text-sm text-muted-foreground">
            {t.install.finish.firmware.line(selection.build.title, selection.build.version, selection.profile.label)}
          </p>
        )}
      </ResultRow>

      <Separator />

      <ResultRow
        icon={KeyRound}
        title={t.install.finish.key.title}
        badge={
          detected ? (
            <Badge variant="success-light">{t.install.finish.key.detected}</Badge>
          ) : (
            <Badge variant="outline">{done ? t.install.finish.key.notConfirmed : t.install.finish.key.notChecked}</Badge>
          )
        }
      >
        {!done && (
          <>
            <div className="flex flex-col gap-2">
              <p className="font-medium">{t.install.finish.key.replug}</p>
              <p>{t.install.finish.key.replugWhy}</p>
              <p className="text-sm text-muted-foreground">
                {openpgp
                  ? t.install.finish.openpgp.replugHint
                  : t.install.finish.key.checkHint(selection?.build.usb.product_name ?? FALLBACK_DEFAULT_NAME, inst.config.name.mode !== "keep")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!openpgp && (
                <Button
                  type="button"
                  disabled={busy || !waiting}
                  onClick={() => {
                    setBusy(true);
                    void actions.connectKey().finally(() => setBusy(false));
                  }}
                >
                  <KeyRound aria-hidden /> {t.common.checkMyKey}
                </Button>
              )}
              <Button type="button" variant={openpgp ? "default" : "outline"} disabled={!waiting} onClick={actions.skipCheck}>
                {openpgp ? t.install.finish.openpgp.done : t.install.finish.key.skip}
              </Button>
            </div>
          </>
        )}
        {detected && state.device && (
          <div className={cn("flex flex-col gap-1", resolved)}>
            <p className="font-medium">{t.install.finish.key.detectedTitle(shownName)}</p>
            <p className="text-sm text-muted-foreground">{t.install.finish.key.landing(state.device.landingUrl ?? null)}</p>
          </div>
        )}
        {done && !detected && openpgp && (
          <div className={cn("flex flex-col gap-2", resolved)}>
            <p className="font-medium">{t.install.finish.openpgp.title}</p>
            <p className="text-sm text-muted-foreground">{t.install.finish.openpgp.text}</p>
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">gpg --card-status</pre>
            <p className="text-sm text-muted-foreground">{t.install.finish.openpgp.pins}</p>
          </div>
        )}
        {done && !detected && !openpgp && (
          <div className={cn("flex flex-col gap-2", resolved)}>
            <p className="font-medium">{t.install.finish.key.unverifiedTitle}</p>
            <p className="text-sm text-muted-foreground">{t.install.finish.key.unverifiedText}</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {t.errors["no-reenumeration"].next.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </ResultRow>

      {!openpgp && (
        <>
          <Separator />

          <ResultRow icon={Tag} title={t.common.deviceName}>
            <NameResult
              name={name}
              request={inst.config.name}
              defaultName={selection?.build.usb.product_name ?? FALLBACK_DEFAULT_NAME}
              onSubmitPin={actions.submitPin}
              onRetry={() => void actions.applyName()}
            />
          </ResultRow>
        </>
      )}

      <Separator />

      <MilestoneList milestones={state.milestones} />
    </StageCard>
  );
}
