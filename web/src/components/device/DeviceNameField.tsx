import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/context";
import { DEVICE_NAME_MAX, validateDeviceName } from "@/lib/device/device-name";
import { cn } from "cn";

/**
 * The key's USB product name: input, live counter, the reason a name would be refused, and "Restore default".
 * Used by the installer (Firmware & name stage) and by First use. The caller owns the value.
 */
export function DeviceNameField(props: {
  value: string;
  onChange: (value: string) => void;
  /** What "Restore default" puts back, and the example shown while the field is empty. */
  defaultName: string;
  id?: string;
  autoFocus?: boolean;
  /** Leave out "Restore default" where the caller already offers the default as its own choice. */
  hideRestore?: boolean;
}) {
  const { t } = useI18n();
  const { value, onChange, defaultName } = props;
  const generated = useId();
  const id = props.id ?? generated;
  const [touched, setTouched] = useState(false);
  const problem = validateDeviceName(value);
  // An empty field is not an error until the person has typed in it.
  const shown = problem !== null && (problem !== "empty" || touched) ? problem : null;
  const over = value.length > DEVICE_NAME_MAX;
  return (
    <Field data-invalid={shown !== null || undefined}>
      <Label htmlFor={id} className="justify-between">
        {t.common.deviceName}
        <span className={cn("tabular-nums", over ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
          {value.length}/{DEVICE_NAME_MAX}
        </span>
      </Label>
      <Input
        id={id}
        value={value}
        maxLength={64}
        placeholder="Mew's Security Key"
        autoComplete="off"
        spellCheck={false}
        autoFocus={props.autoFocus}
        aria-invalid={shown !== null}
        aria-describedby={shown ? `${id}-error` : undefined}
        onChange={(e) => {
          setTouched(true);
          onChange(e.target.value);
        }}
        onBlur={() => setTouched(true)}
      />
      {shown && (
        <FieldError id={`${id}-error`} className="enter-reveal">
          {t.nameProblems[shown]}
        </FieldError>
      )}
      {!props.hideRestore && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(defaultName)}>
            {t.device.nameField.restore}
          </Button>
        </div>
      )}
    </Field>
  );
}
