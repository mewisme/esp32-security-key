import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cliFallback } from "@/lib/device/cli-fallback";
import type { NameRequest } from "@/lib/device/mkauth";
import type { NameState } from "@/lib/device/personalize";
import { ERRORS } from "@/lib/errors/catalog";

/** The BOOT-button wait of the firmware (multikey_auth: 15000 ms). */
const BUTTON_SECONDS = 15;
const PIN_MIN = 6;
const PIN_MAX = 63;

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm" role="status">
      <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
      {children}
    </p>
  );
}

function ButtonPrompt() {
  const [left, setLeft] = useState(BUTTON_SECONDS);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-2" role="status">
      <Badge variant="primary-light">Press the BOOT button on your key now</Badge>
      <span className="text-xs text-muted-foreground tabular-nums">{left} s left</span>
    </div>
  );
}

function PinForm({ name, onSubmit }: { name: NameState; onSubmit: (pin: string) => void | Promise<void> }) {
  const id = useId();
  // The PIN lives here until it is sent to the key, then it is cleared. It is never stored or logged.
  const [pin, setPin] = useState("");
  const wrong = name.error === "name-pin-wrong";
  const bytes = new TextEncoder().encode(pin).length;
  const tries = name.triesLeft;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (bytes < PIN_MIN || bytes > PIN_MAX) return;
        const sent = pin;
        setPin("");
        void onSubmit(sent);
      }}
    >
      <Field data-invalid={wrong || undefined}>
        <Label htmlFor={id}>Management PIN</Label>
        <Input
          id={id}
          type="password"
          autoComplete="off"
          value={pin}
          aria-invalid={wrong}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setPin(e.target.value)}
        />
        <FieldDescription id={`${id}-hint`}>
          This key has a management PIN ({PIN_MIN}–{PIN_MAX} characters). It is sent to the key and never stored.
        </FieldDescription>
        {wrong && (
          <FieldError>
            {ERRORS["name-pin-wrong"].what}
            {tries !== undefined && ` ${tries} ${tries === 1 ? "try" : "tries"} left`}
          </FieldError>
        )}
      </Field>
      <Button type="submit" className="self-start" disabled={bytes < PIN_MIN || bytes > PIN_MAX}>
        Send PIN
      </Button>
    </form>
  );
}

function Failure(props: { name: NameState; request: NameRequest; onRetry: () => void }) {
  const { name } = props;
  const info = ERRORS[name.error ?? "name-failed"];
  const sw = /status ([0-9a-f]{4})/i.exec(name.detail ?? "")?.[1]?.toUpperCase();
  const cli = cliFallback(props.request);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 font-medium">
          <TriangleAlert className="size-4 text-warning" aria-hidden />
          {info.title}
        </p>
        <p className="text-sm text-muted-foreground">
          {info.what}
          {sw && ` (status ${sw})`}
        </p>
      </div>
      {cli && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Or rename it from the command line with the host tools:</p>
          <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">{cli}</code>
        </div>
      )}
      {info.retry && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={props.onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Outcome of asking the key for a new name, as the user sees it. Shared by the installer's Finish stage and First use.
 * `request` is what was asked for; `onSubmitPin` receives the management PIN and must not keep it.
 */
export function NameResult(props: {
  name: NameState;
  request: NameRequest;
  /** Name the firmware shows until the person picks one. */
  defaultName: string;
  onSubmitPin: (pin: string) => void | Promise<void>;
  onRetry: () => void;
}) {
  const { name, request } = props;
  const status = request.mode === "keep" ? "kept" : name.status === "kept" ? "kept" : name.status;
  let body: React.ReactNode;
  switch (status) {
    case "kept":
      body = <Badge variant="outline">Not requested — current name kept</Badge>;
      break;
    case "idle":
      body = (
        <p className="text-sm text-muted-foreground">
          {request.mode === "custom" ? `Will be set to “${request.name}”` : `Will be reset to “${props.defaultName}”`} when you check your key.
        </p>
      );
      break;
    case "connecting":
      body = <Waiting>Talking to your key…</Waiting>;
      break;
    case "needs-pin":
      body = <PinForm name={name} onSubmit={props.onSubmitPin} />;
      break;
    case "press-button":
      body = <ButtonPrompt />;
      break;
    case "reconnecting":
      body = <Waiting>Waiting for your key to reconnect…</Waiting>;
      break;
    case "verified":
      body = <Badge variant="success-light">Applied and verified: {name.applied}</Badge>;
      break;
    default:
      body = <Failure name={name} request={request} onRetry={props.onRetry} />;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="name-result" data-status={status}>
      {body}
    </div>
  );
}
