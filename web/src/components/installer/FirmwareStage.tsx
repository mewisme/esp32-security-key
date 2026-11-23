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
import { formatDate } from "@/components/releases/format-date";
import { FALLBACK_DEFAULT_NAME, validateDeviceName } from "@/lib/device/device-name";
import type { NameRequest } from "@/lib/device/mkauth";
import { buildsBySize, type CatalogRelease } from "@/lib/firmware/catalog";
import { useI18n } from "@/i18n/context";
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
  const { t, locale } = useI18n();
  const { catalog } = inst;
  if (catalog.status === "loading") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label={t.common.loadingReleases}>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (catalog.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t.install.firmware.listFailed}</AlertTitle>
        <AlertDescription>
          <p>{t.install.firmware.checkConnection}</p>
          <Button type="button" variant="outline" size="sm" onClick={inst.loadCatalog}>
            {t.common.tryAgain}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const releases = catalog.catalog.releases;
  if (releases.length === 0) {
    return (
      <Alert>
        <AlertTitle>{t.common.noFirmwareRelease}</AlertTitle>
        <AlertDescription>{t.install.firmware.noReleaseText}</AlertDescription>
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
                  <Badge variant={r.prerelease ? "warning-light" : "success-light"}>
                    {r.prerelease ? t.common.preRelease : t.common.stable}
                  </Badge>
                </FieldTitle>
                <FieldDescription>
                  {t.install.firmware.version(r.manifest.version, r.publishedAt ? formatDate(r.publishedAt, locale) : null)}
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
                      {t.common.releaseNotes} <ExternalLink className="size-3" aria-hidden />
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
            <FieldTitle>{t.install.firmware.openpgp.title}</FieldTitle>
            <FieldDescription>{t.install.firmware.openpgp.text}</FieldDescription>
          </FieldContent>
          <RadioGroupItem id="rel-openpgp" value="openpgp" disabled />
        </Field>
      </FieldLabel>
    </RadioGroup>
  );
}

type Mode = NameRequest["mode"];

const NAME_MODES: Mode[] = ["keep", "custom", "default"];

export function FirmwareStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t } = useI18n();
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
      ? config.name.name || t.install.firmware.customPreview
      : config.name.mode === "default"
        ? defaultName
        : t.install.firmware.currentPreview;

  return (
    <StageCard
      title={t.install.steps.firmware}
      description={t.install.firmware.description}
      headingRef={headingRef}
      secondary={
        <Button type="button" variant="outline" onClick={actions.back}>
          {t.common.back}
        </Button>
      }
      primary={
        <Button type="button" disabled={!selected || nameInvalid} onClick={actions.selectFirmware}>
          {t.common.continue}
        </Button>
      }
    >
      <FieldSet>
        <FieldLegend variant="label">{t.common.firmware}</FieldLegend>
        <ReleaseTiles inst={inst} selectedTag={selectedTag} />
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">{t.install.firmware.personalize}</FieldLegend>
        <RadioGroup value={mode} onValueChange={chooseMode}>
          {NAME_MODES.map((m) => (
            <FieldLabel key={m} htmlFor={`name-${m}`}>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{t.install.firmware.nameOptions[m].title}</FieldTitle>
                  <FieldDescription>{t.install.firmware.nameOptions[m].text}</FieldDescription>
                </FieldContent>
                <RadioGroupItem id={`name-${m}`} value={m} />
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
            <span className="text-xs text-muted-foreground">{t.install.firmware.usbKey} · 303A:4002</span>
          </div>
        </div>
      </FieldSet>
    </StageCard>
  );
}
