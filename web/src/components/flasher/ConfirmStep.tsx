import { Info, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Selection } from "@/hooks/useInstaller";
import { ERRORS } from "@/lib/errors/catalog";
import type { ChipInfo } from "@/lib/flashing/driver";
import type { AckId, InstallDecision, InstallMode } from "@/lib/flashing/install-mode";
import { formatBytes, formatHex } from "@/lib/format";

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
};

const ROLE_TEXT: Record<string, string> = {
  bootloader: "Bootloader",
  "partition-table": "Partition table",
  app: "MultiKeys app",
};

export function ConfirmStep(props: {
  decision: InstallDecision;
  chip: ChipInfo | null;
  selection: Selection;
  uartPort: boolean;
  onConfirm: (acks: AckId[]) => void;
  onCancel: () => void;
}) {
  const { decision, chip, selection } = props;
  const { build, release } = selection;
  const [acks, setAcks] = useState<AckId[]>([]);
  const [typed, setTyped] = useState("");
  const given: AckId[] = [...acks, ...(typed === "REPURPOSE" ? (["repurpose-typed"] as const) : [])];
  const ready = decision.acks.every((a) => given.includes(a));
  const filled = new Set(decision.writes.filter((w) => w.kind === "fill").map((w) => w.role));
  const untouched = build.protected_partitions.filter((p) => !filled.has(p));
  return (
    <div className="space-y-6">
      <Table>
        <TableBody>
          <TableRow>
            <TableHead scope="row">Board</TableHead>
            <TableCell className="whitespace-normal">
              {chip?.description ?? chip?.chipName ?? "?"}, {chip?.flashSize ?? "?"} flash, MAC <span className="font-mono">{chip?.mac ?? "?"}</span>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">Firmware</TableHead>
            <TableCell className="whitespace-normal">
              {build.title}, version {build.version} ({release.tag})
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead scope="row">Install type</TableHead>
            <TableCell className="whitespace-normal font-medium" data-testid="install-mode">
              {MODE_TITLE[decision.mode]}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <div>
        <h3 className="mb-2 font-medium">What will be written</h3>
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
                <TableCell>{w.kind === "fill" ? `Clear the ${w.role} area` : ROLE_TEXT[w.role] ?? w.role}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-2 text-sm text-muted-foreground">
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

      {props.uartPort && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>{ERRORS["wrong-connector"].title}</AlertTitle>
          <AlertDescription>{ERRORS["wrong-connector"].what}</AlertDescription>
        </Alert>
      )}

      <fieldset className="space-y-3">
        <legend className="mb-1 font-medium">Before installing</legend>
        {decision.acks
          .filter((a): a is Exclude<AckId, "repurpose-typed"> => a !== "repurpose-typed")
          .map((a) => (
            <Label key={a} className="flex items-start gap-3 font-normal">
              <Checkbox
                className="mt-0.5"
                checked={acks.includes(a)}
                onCheckedChange={(v) => setAcks((cur) => (v === true ? [...cur, a] : cur.filter((x) => x !== a)))}
              />
              {ACK_TEXT[a]}
            </Label>
          ))}
        {decision.acks.includes("repurpose-typed") && (
          <div className="space-y-1">
            <Label htmlFor="repurpose-confirm">Type REPURPOSE to confirm that the nvs and part0 areas will be erased</Label>
            <Input id="repurpose-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="max-w-xs font-mono" />
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={!ready} onClick={() => props.onConfirm(given)}>
          Install firmware
        </Button>
        <Button size="lg" variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
