import { Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Installer, isUartBridge } from "@/hooks/useInstaller";
import { ERRORS } from "@/lib/errors/catalog";
import type { AckId, InstallMode } from "@/lib/flashing/install-mode";
import { formatBytes, formatHex } from "@/lib/format";
import { CompatibilityBadge, StageCard } from "./StageCard";

const MODE_TITLE: Record<InstallMode, string> = {
  "first-install": "First installation",
  update: "Update",
  "update-unverified": "Update (stored keys not guaranteed)",
  "switch-image": "Switch to a different MultiKeys firmware",
  "replace-compatible-layout": "Replace the firmware on this board",
  repurpose: "Repurpose this board",
  blocked: "Blocked",
};

function riskText(mode: InstallMode, from: string): string {
  switch (mode) {
    case "first-install":
      return "The board's flash is empty, so there is nothing to lose.";
    case "update":
      return `Your keys are stored in an area the installer does not write. This release declares it can read data from version ${from} and later.`;
    case "update-unverified":
      return `The installed MultiKeys firmware is older than ${from} or doesn't declare a compatible version. The area holding your keys is not written, but this firmware may not be able to use keys created by the installed one.`;
    case "switch-image":
      return "The board runs the other MultiKeys firmware. The storage area is not written, but its contents belong to the other firmware and will not be usable.";
    case "replace-compatible-layout":
      return "The board runs firmware that isn't MultiKeys but uses the same storage layout. That firmware will be replaced; the storage area is not written.";
    case "repurpose":
      return "The board uses a different storage layout, for example factory demo firmware. To install MultiKeys the installer first clears the nvs and part0 areas — everything the previous firmware stored there is erased — and then writes MultiKeys. Nothing else is erased.";
    case "blocked":
      return ERRORS["storage-incompatible"].what;
  }
}

const ACK_TEXT: Record<Exclude<AckId, "repurpose-typed">, string> = {
  "dev-firmware": "I understand this is experimental development firmware and not suitable for protecting important accounts.",
  "update-unverified": "I understand keys stored by the installed version may not be usable after this update.",
  "switch-image": "I understand data from the other MultiKeys firmware will not be usable.",
  "replace-layout": "I understand the firmware currently on this board will be replaced.",
  "untested-hardware": "I understand this board type hasn't been tested with MultiKeys",
};

const ROLE_TEXT: Record<string, string> = {
  bootloader: "Bootloader",
  "partition-table": "Partition table",
  app: "MultiKeys app",
};

export function ReviewStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { state, selection, actions, config } = inst;
  const { decision, chip } = state;
  const [acks, setAcks] = useState<AckId[]>([]);
  const [typed, setTyped] = useState("");
  if (!decision || !selection) return null;
  const { build, release, profile, support } = selection;

  const given: AckId[] = [...acks, ...(typed === "REPURPOSE" ? (["repurpose-typed"] as const) : [])];
  const ready = decision.acks.every((a) => given.includes(a));
  const filled = new Set(decision.writes.filter((w) => w.kind === "fill").map((w) => w.role));
  const untouched = build.protected_partitions.filter((p) => !filled.has(p));
  const req = config.name;
  const nameWords =
    req.mode === "keep" ? "Keep current name" : req.mode === "default" ? `Reset to ${build.usb.product_name}` : req.name;
  const untested = decision.acks.includes("untested-hardware");

  return (
    <StageCard
      title="Review"
      description="Check what will happen. Nothing has been written yet."
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={() => void actions.cancel()}>
          Cancel
        </Button>
      }
      primary={
        <Button type="button" disabled={!ready} onClick={() => void actions.confirm(given)}>
          Install firmware
        </Button>
      }
    >
      <Table>
        <TableBody>
          <TableRow>
            <TableHead scope="row">Board</TableHead>
            <TableCell className="whitespace-normal">
              {chip?.description || chip?.chipName || "?"}
              <span className="block text-xs text-muted-foreground">
                MAC <span className="font-mono">{chip?.mac ?? "?"}</span>
              </span>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">Flash</TableHead>
            <TableCell className="whitespace-normal">
              {chip?.flashSize ?? profile.flash_size} · {chip?.flashType ?? profile.flash_interface}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">Firmware</TableHead>
            <TableCell className="whitespace-normal">
              <span className="font-medium">MultiKeys FIDO2 — {profile.label}</span>
              <span className="block text-xs text-muted-foreground">
                {build.title}, version {build.version} ({release.tag})
              </span>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">Compatibility</TableHead>
            <TableCell className="whitespace-normal">
              <CompatibilityBadge support={support} verifiedAs={selection.verifiedAs} />
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">Device name</TableHead>
            <TableCell className="whitespace-normal">{nameWords}</TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">Install mode</TableHead>
            <TableCell className="font-medium whitespace-normal" data-testid="install-mode">
              {MODE_TITLE[decision.mode]}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">What will be written</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>What</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {decision.writes.map((w) => (
              <TableRow key={`${w.kind}-${w.offset}`}>
                <TableCell className="font-mono">{formatHex(w.offset)}</TableCell>
                <TableCell>{formatBytes(w.length)}</TableCell>
                <TableCell>{w.kind === "fill" ? `Clear the ${w.role} area` : (ROLE_TEXT[w.role] ?? w.role)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-sm text-muted-foreground">
          Never touched: {untouched.map((p) => (p === "part0" ? "part0 (your keys)" : p)).join(", ")}
          {untouched.length ? ", " : ""}eFuses (permanent chip settings).
        </p>
      </div>

      <Alert variant={decision.mode === "repurpose" ? "destructive" : "default"}>
        {decision.mode === "repurpose" ? <ShieldAlert aria-hidden /> : <Info aria-hidden />}
        <AlertTitle>Your data</AlertTitle>
        <AlertDescription>
          <p>{riskText(decision.mode, build.update.data_preserving_from)}</p>
          <p className="text-xs">Why: {decision.reason}</p>
        </AlertDescription>
      </Alert>

      {isUartBridge(state.port) && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>{ERRORS["wrong-connector"].title}</AlertTitle>
          <AlertDescription>{ERRORS["wrong-connector"].what}</AlertDescription>
        </Alert>
      )}

      {untested && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>Not tested on this board</AlertTitle>
          <AlertDescription>
            {support === "expected-compatible" ? (
              <p>
                This is the build that runs on the tested ESP32-S3 N16R8, but this exact board hasn't been tested with MultiKeys. It passes
                every image check.
              </p>
            ) : (
              <p>
                MultiKeys has only been tested on ESP32-S3 N16R8. This {profile.flash_size.replace("MB", " MB")} build compiles and passes
                every image check, but nobody has run it on a {profile.flash_size.replace("MB", " MB")} board yet.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <FieldSet>
        <legend className="mb-1 font-medium">Before installing</legend>
        {decision.acks
          .filter((a): a is Exclude<AckId, "repurpose-typed"> => a !== "repurpose-typed")
          .map((a) => (
            <Field key={a} orientation="horizontal">
              <Checkbox
                id={`ack-${a}`}
                checked={acks.includes(a)}
                onCheckedChange={(v) => setAcks((cur) => (v === true ? [...cur, a] : cur.filter((x) => x !== a)))}
              />
              <Label htmlFor={`ack-${a}`} className="font-normal">
                {ACK_TEXT[a]}
              </Label>
            </Field>
          ))}
        {decision.acks.includes("repurpose-typed") && (
          <Field>
            <Label htmlFor="repurpose-confirm">Type REPURPOSE to confirm that the nvs and part0 areas will be erased</Label>
            <Input id="repurpose-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="max-w-xs font-mono" />
          </Field>
        )}
      </FieldSet>
    </StageCard>
  );
}
