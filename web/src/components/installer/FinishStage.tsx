import { Cpu, KeyRound, type LucideIcon, Tag } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { NameResult } from "@/components/device/NameResult";
import { MilestoneList } from "@/components/flasher/MilestoneList";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Installer } from "@/hooks/useInstaller";
import { FALLBACK_DEFAULT_NAME } from "@/lib/device/device-name";
import { ERRORS } from "@/lib/errors/catalog";
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
  const { state, actions, name, selection } = inst;
  const [busy, setBusy] = useState(false);
  const done = state.phase === "completed";
  const waiting = state.phase === "awaiting-reenumeration";
  const detected = done && state.milestones.deviceDetected && state.device;
  const shownName = name.applied ?? state.device?.productName ?? "unnamed USB device";

  return (
    <StageCard
      title="Finish"
      description={done ? "The firmware is installed." : "The firmware is written. Replug the board to continue."}
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={() => void actions.reset()}>
          Start over
        </Button>
      }
      primary={
        done ? (
          <Button asChild>
            <Link to="/first-use">First use →</Link>
          </Button>
        ) : undefined
      }
    >
      <ResultRow
        icon={Cpu}
        title="Firmware"
        badge={
          state.milestones.flashVerified ? (
            <Badge variant="success-light">Written and verified</Badge>
          ) : (
            <Badge variant="outline">Not verified</Badge>
          )
        }
      >
        {selection && (
          <p className="text-sm text-muted-foreground">
            {selection.build.title}, version {selection.build.version} · {selection.profile.label}
          </p>
        )}
      </ResultRow>

      <Separator />

      <ResultRow
        icon={KeyRound}
        title="Running key"
        badge={detected ? <Badge variant="success-light">Detected</Badge> : <Badge variant="outline">{done ? "Not confirmed" : "Not checked"}</Badge>}
      >
        {!done && (
          <>
            <div className="flex flex-col gap-2">
              <p className="font-medium">Now unplug the board and plug it back in, without holding BOOT.</p>
              <p>
                The board usually stays in installer mode until it is replugged. After that its serial port is gone and it appears as a
                security key instead; that is expected.
              </p>
              <p className="text-sm text-muted-foreground">
                “Check my key” asks the browser to show the key; pick the entry named after your key (by default “{selection?.build.usb.product_name ?? FALLBACK_DEFAULT_NAME}”).
                {inst.config.name.mode !== "keep" && " It then applies the name you chose; you will be asked to press BOOT on the key."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || !waiting}
                onClick={() => {
                  setBusy(true);
                  void actions.connectKey().finally(() => setBusy(false));
                }}
              >
                <KeyRound aria-hidden /> Check my key
              </Button>
              <Button type="button" variant="outline" disabled={!waiting} onClick={actions.skipCheck}>
                Skip this check
              </Button>
            </div>
          </>
        )}
        {detected && state.device && (
          <div className="flex flex-col gap-1">
            <p className="font-medium">Key detected: {shownName}</p>
            <p className="text-sm text-muted-foreground">
              Landing page: {state.device.landingUrl ?? "not checked (the browser couldn't read it; that is common on Windows and harmless)"}
            </p>
          </div>
        )}
        {done && !detected && (
          <div className="flex flex-col gap-2">
            <p className="font-medium">Flash verified; running key not checked</p>
            <p className="text-sm text-muted-foreground">Firmware written and verified; key not yet detected.</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {ERRORS["no-reenumeration"].next.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </ResultRow>

      <Separator />

      <ResultRow icon={Tag} title="Device name">
        <NameResult
          name={name}
          request={inst.config.name}
          defaultName={selection?.build.usb.product_name ?? FALLBACK_DEFAULT_NAME}
          onSubmitPin={actions.submitPin}
          onRetry={() => void actions.applyName()}
        />
      </ResultRow>

      <Separator />

      <MilestoneList milestones={state.milestones} />
    </StageCard>
  );
}
