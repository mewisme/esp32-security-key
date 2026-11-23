import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n/context";
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
  const { t } = useI18n();
  const [left, setLeft] = useState(BUTTON_SECONDS);
  useEffect(() => {
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col gap-2" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="primary-light">{t.device.nameResult.pressBoot}</Badge>
        {left > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">{t.device.nameResult.secondsLeft(left)}</span>
        ) : (
          // The key's own window is over: it is either saving the name or about to say the button was missed.
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden />
            {t.device.nameResult.talking}
          </span>
        )}
      </div>
      <Progress value={(left / BUTTON_SECONDS) * 100} aria-hidden="true" />
    </div>
  );
}

function PinForm({ name, onSubmit }: { name: NameState; onSubmit: (pin: string) => void | Promise<void> }) {
  const { t } = useI18n();
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
        <Label htmlFor={id}>{t.device.nameResult.pinLabel}</Label>
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
          {t.device.nameResult.pinHint(PIN_MIN, PIN_MAX)}
        </FieldDescription>
        {wrong && (
          <FieldError>
            {t.errors["name-pin-wrong"].what}
            {tries !== undefined && ` ${t.device.nameResult.triesLeft(tries)}`}
          </FieldError>
        )}
      </Field>
      <Button type="submit" className="self-start" disabled={bytes < PIN_MIN || bytes > PIN_MAX}>
        {t.device.nameResult.sendPin}
      </Button>
    </form>
  );
}

function Failure(props: { name: NameState; request: NameRequest; onRetry: () => void }) {
  const { t } = useI18n();
  const { name } = props;
  const info = t.errors[name.error ?? "name-failed"];
  const retry = ERRORS[name.error ?? "name-failed"].retry;
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
          {sw && ` ${t.device.nameResult.status(sw)}`}
        </p>
      </div>
      {cli && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">{t.device.nameResult.cli}</p>
          <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">{cli}</code>
        </div>
      )}
      {retry && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={props.onRetry}>
          {t.common.tryAgain}
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
  const { t } = useI18n();
  const { name, request } = props;
  const status = request.mode === "keep" ? "kept" : name.status === "kept" ? "kept" : name.status;
  let body: React.ReactNode;
  switch (status) {
    case "kept":
      body = <Badge variant="outline">{t.device.nameResult.kept}</Badge>;
      break;
    case "idle":
      body = (
        <p className="text-sm text-muted-foreground">
          {request.mode === "custom" ? t.device.nameResult.willSet(request.name) : t.device.nameResult.willReset(props.defaultName)}
        </p>
      );
      break;
    case "connecting":
      body = <Waiting>{t.device.nameResult.talking}</Waiting>;
      break;
    case "needs-pin":
      body = <PinForm name={name} onSubmit={props.onSubmitPin} />;
      break;
    case "press-button":
      body = <ButtonPrompt />;
      break;
    case "reconnecting":
      body = <Waiting>{t.device.nameResult.reconnecting}</Waiting>;
      break;
    case "verified":
      body = <Badge variant="success-light">{t.device.nameResult.applied(name.applied ?? "")}</Badge>;
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
