import { ExternalLink, Usb } from "lucide-react";
import { useState } from "react";
import { DeviceNameField } from "@/components/device/DeviceNameField";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import type { Installer } from "@/hooks/useInstaller";
import { FALLBACK_DEFAULT_NAME, validateDeviceName } from "@/lib/device/device-name";
import type { NameRequest } from "@/lib/device/mkauth";
import { buildsBySize, type CatalogRelease } from "@/lib/firmware/catalog";
import { profileById } from "@/lib/firmware/policy";
import { StageCard } from "./StageCard";

/** "4 / 8 / 16 MB" from the fido builds' profiles, smallest first. */
function sizesLabel(release: CatalogRelease): string {
  const labels = buildsBySize(release.manifest.builds)
    .filter((b) => b.image === "fido")
    .map((b) => (profileById(b.profile_id)?.label ?? b.flash_size).replace(/\s*MB$/, ""));
  return labels.length ? `${labels.join(" / ")} MB` : "";
}

function ReleaseTiles({ inst, selectedTag }: { inst: Installer; selectedTag: string | null }) {
  const { catalog } = inst;
  if (catalog.status === "loading") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading releases">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (catalog.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>The firmware list couldn't be loaded</AlertTitle>
        <AlertDescription>
          <p>Check your internet connection.</p>
          <Button type="button" variant="outline" size="sm" onClick={inst.loadCatalog}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const releases = catalog.catalog.releases;
  if (releases.length === 0) {
    return (
      <Alert>
        <AlertTitle>No firmware release yet</AlertTitle>
        <AlertDescription>Prebuilt firmware isn't published yet. Check back later or use the developer method from the README.</AlertDescription>
      </Alert>
    );
  }
  return (
    <RadioGroup value={selectedTag ?? ""} onValueChange={inst.actions.setRelease}>
      {releases.map((r) => {
        const build = r.manifest.builds.find((b) => b.image === "fido");
        const sizes = sizesLabel(r);
        return (
          <FieldLabel key={r.tag} htmlFor={`rel-${r.tag}`}>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>
                  {build?.title ?? r.name}
                  <Badge variant={r.prerelease ? "warning-light" : "success-light"}>{r.prerelease ? "Pre-release" : "Stable"}</Badge>
                </FieldTitle>
                <FieldDescription>
                  Version {r.manifest.version}
                  {r.publishedAt ? ` · ${new Date(r.publishedAt).toLocaleDateString()}` : ""}
                </FieldDescription>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {sizes && <Badge variant="outline">{sizes}</Badge>}
                  {r.notesUrl && (
                    <a
                      className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
                      href={r.notesUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Release notes <ExternalLink className="size-3" aria-hidden />
                    </a>
                  )}
                </div>
              </FieldContent>
              <RadioGroupItem id={`rel-${r.tag}`} value={r.tag} />
            </Field>
          </FieldLabel>
        );
      })}
      <FieldLabel htmlFor="rel-openpgp">
        <Field orientation="horizontal" data-disabled="true">
          <FieldContent>
            <FieldTitle>MultiKeys OpenPGP — not published</FieldTitle>
            <FieldDescription>Not available in the web installer; build it from source with the developer script.</FieldDescription>
          </FieldContent>
          <RadioGroupItem id="rel-openpgp" value="openpgp" disabled />
        </Field>
      </FieldLabel>
    </RadioGroup>
  );
}

type Mode = NameRequest["mode"];

const NAME_OPTIONS: { mode: Mode; title: string; text: string }[] = [
  {
    mode: "keep",
    title: "Don't change the name",
    text: `New keys show "${FALLBACK_DEFAULT_NAME}"; updated keys keep their current name.`,
  },
  { mode: "custom", title: "Custom name", text: "Up to 31 plain ASCII characters. Applied after the firmware is installed." },
  { mode: "default", title: "Reset to the default name", text: `Sets the name back to "${FALLBACK_DEFAULT_NAME}".` },
];

export function FirmwareStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { config, catalog, actions } = inst;
  const releases = catalog.status === "ready" ? catalog.catalog.releases : [];
  const selected = releases.find((r) => r.tag === config.tag) ?? inst.defaultRelease;
  const selectedTag = selected?.tag ?? null;
  const defaultName =
    selected?.manifest.builds.find((b) => b.image === "fido")?.usb.product_name ?? FALLBACK_DEFAULT_NAME;

  // The typed text survives switching between the three options (and Back/Continue through the persisted config).
  const [customText, setCustomText] = useState(config.name.mode === "custom" ? config.name.name : "");
  const mode = config.name.mode;

  const chooseMode = (m: string) => {
    if (m === "custom") actions.setNameRequest({ mode: "custom", name: customText });
    else if (m === "keep" || m === "default") actions.setNameRequest({ mode: m });
  };
  const changeText = (value: string) => {
    setCustomText(value);
    actions.setNameRequest({ mode: "custom", name: value });
  };

  const nameInvalid = config.name.mode === "custom" && validateDeviceName(config.name.name) !== null;
  const previewName =
    config.name.mode === "custom"
      ? config.name.name || "Your custom name"
      : config.name.mode === "default"
        ? defaultName
        : "your key's current name";

  return (
    <StageCard
      title="Firmware & name"
      description="Choose the firmware release and, if you like, a name for your key."
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={actions.back}>
          Back
        </Button>
      }
      primary={
        <Button type="button" disabled={!selected || nameInvalid} onClick={actions.selectFirmware}>
          Continue
        </Button>
      }
    >
      <FieldSet>
        <FieldLegend variant="label">Firmware</FieldLegend>
        <ReleaseTiles inst={inst} selectedTag={selectedTag} />
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Personalize your MultiKeys</FieldLegend>
        <RadioGroup value={mode} onValueChange={chooseMode}>
          {NAME_OPTIONS.map((o) => (
            <FieldLabel key={o.mode} htmlFor={`name-${o.mode}`}>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{o.title}</FieldTitle>
                  <FieldDescription>{o.text}</FieldDescription>
                </FieldContent>
                <RadioGroupItem id={`name-${o.mode}`} value={o.mode} />
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
        {config.name.mode === "custom" && (
          <DeviceNameField id="device-name" value={config.name.name} onChange={changeText} defaultName={FALLBACK_DEFAULT_NAME} />
        )}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
          <Usb className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{previewName}</span>
            <span className="text-xs text-muted-foreground">USB security key · 303A:4002</span>
          </div>
        </div>
      </FieldSet>
    </StageCard>
  );
}
