import { ExternalLink, Info, TriangleAlert, Usb } from "lucide-react";
import { useState } from "react";
import { DeviceNameField } from "@/components/device/DeviceNameField";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useChangedSinceMount } from "@/hooks/useChangedSinceMount";
import type { Installer } from "@/hooks/useInstaller";
import { formatDate } from "@/components/releases/format-date";
import { FALLBACK_DEFAULT_NAME, validateDeviceName } from "@/lib/device/device-name";
import type { NameRequest } from "@/lib/device/mkauth";
import { buildsBySize, type CatalogRelease } from "@/lib/firmware/catalog";
import { useI18n } from "@/i18n/context";
import { profileById } from "@/lib/firmware/policy";
import { StageCard } from "./StageCard";

type Image = "fido" | "openpgp";

function hasImage(release: CatalogRelease, image: Image): boolean {
  return release.manifest.builds.some((b) => b.image === image);
}

/** "4 / 8 / 16 MB" from the chosen image's builds' profiles, smallest first. */
function sizesLabel(release: CatalogRelease, image: Image): string {
  const labels = buildsBySize(release.manifest.builds)
    .filter((b) => b.image === image)
    .map((b) => (profileById(b.profile_id)?.label ?? b.flash_size).replace(/\s*MB$/, ""));
  return labels.length ? `${labels.join(" / ")} MB` : "";
}

/** "303A:4002" from the firmware's own USB metadata. */
function vidPid(release: CatalogRelease | undefined): string | null {
  const usb = release?.manifest.builds.find((b) => b.image === "fido")?.usb;
  if (!usb) return null;
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
  return `${hex(usb.vid)}:${hex(usb.pid)}`;
}

export function ReleaseBadges({ release, latestStable }: { release: CatalogRelease; latestStable: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {latestStable && <Badge variant="primary-light">{t.install.firmware.latest}</Badge>}
      <Badge variant={release.prerelease ? "warning-light" : "success-light"}>{release.prerelease ? t.common.preRelease : t.common.stable}</Badge>
    </>
  );
}

function ReleaseNotesLink({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <a className="inline-flex items-center gap-1 underline underline-offset-4 transition-colors hover:text-primary" href={url} target="_blank" rel="noopener noreferrer">
      {t.common.releaseNotes} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

/** The chosen release in full, and a Select that holds the other versions. */
function FirmwareSection({ inst, selected }: { inst: Installer; selected: CatalogRelease | null }) {
  const { t, locale } = useI18n();
  const { catalog, config, actions } = inst;
  // The summary replaces its skeleton (or an error) once the catalog answers; one that is already there rides on the stage.
  const reveal = useChangedSinceMount(catalog.status) ? "enter-reveal" : undefined;

  if (catalog.status === "loading") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label={t.common.loadingReleases}>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-9 w-full sm:w-72" />
      </div>
    );
  }
  if (catalog.status === "error") {
    return (
      <Alert variant="destructive" className={reveal}>
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
  if (releases.length === 0 || !selected) {
    return (
      <Alert className={reveal}>
        <AlertTitle>{t.common.noFirmwareRelease}</AlertTitle>
        <AlertDescription>{t.install.firmware.noReleaseText}</AlertDescription>
      </Alert>
    );
  }

  // "Latest" means the newest stable release; the newest release overall may be a pre-release.
  const latestStableTag = releases.find((r) => !r.prerelease)?.tag;
  const build = selected.manifest.builds.find((b) => b.image === config.image);
  const sizes = sizesLabel(selected, config.image);
  const date = selected.publishedAt ? formatDate(selected.publishedAt, locale) : null;
  const openpgpAvailable = hasImage(selected, "openpgp");

  return (
    <div className={`flex flex-col gap-4 ${reveal ?? ""}`}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="text-base font-semibold tracking-tight">{build?.title ?? selected.name}</span>
            <span className="tabular-nums text-muted-foreground">v{selected.manifest.version}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <ReleaseBadges release={selected} latestStable={selected.tag === latestStableTag} />
          </div>
        </div>
        {sizes && <p className="text-sm text-muted-foreground">{t.install.firmware.flashSizes(sizes)}</p>}
        {(date || selected.notesUrl) && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            {date && <span>{t.install.firmware.released(date)}</span>}
            {date && selected.notesUrl && <span aria-hidden>·</span>}
            {selected.notesUrl && <ReleaseNotesLink url={selected.notesUrl} />}
          </p>
        )}
      </div>

      {releases.length > 1 && (
        <Field className="sm:max-w-80">
          <Label htmlFor="release-select" className="text-xs text-muted-foreground">
            {t.install.firmware.chooseVersion}
          </Label>
          <Select value={selected.tag} onValueChange={actions.setRelease}>
            <SelectTrigger id="release-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {releases.map((r) => (
                  <SelectItem key={r.tag} value={r.tag}>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <span className="font-medium tabular-nums">v{r.manifest.version}</span>
                      <ReleaseBadges release={r} latestStable={r.tag === latestStableTag} />
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}

      {openpgpAvailable || config.image === "openpgp" ? (
        <FieldSet className="gap-2">
          <FieldLegend variant="label">
            {t.install.firmware.imageLegend}
          </FieldLegend>
          <RadioGroup
            value={config.image}
            onValueChange={(v) => (v === "fido" || v === "openpgp") && actions.setImage(v)}
            className="flex flex-wrap items-center gap-x-6 gap-y-2"
          >
            {(["fido", "openpgp"] as const).map((img) => (
              <Field key={img} orientation="horizontal" className="w-auto" data-disabled={hasImage(selected, img) ? undefined : "true"}>
                <RadioGroupItem id={`image-${img}`} value={img} disabled={!hasImage(selected, img)} />
                <FieldLabel htmlFor={`image-${img}`} className="cursor-pointer">
                  {t.install.firmware.images[img].title}
                  {img === "openpgp" && <Badge variant="warning-light">{t.install.firmware.experimental}</Badge>}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
          <p className="text-sm text-muted-foreground">{t.install.firmware.images[config.image].text}</p>
        </FieldSet>
      ) : null}
      {!openpgpAvailable && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="openpgp-unavailable">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t.install.firmware.openpgpUnavailable}
        </p>
      )}
      {config.image === "openpgp" && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t.install.firmware.openpgpWarning.title}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {t.install.firmware.openpgpWarning.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

type Mode = NameRequest["mode"];

const NAME_MODES: Mode[] = ["keep", "custom", "default"];

export function FirmwareStage({ inst, headingRef }: { inst: Installer; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { t } = useI18n();
  const { config, catalog, actions } = inst;
  const releases = catalog.status === "ready" ? catalog.catalog.releases : [];
  const selected = releases.find((r) => r.tag === config.tag) ?? inst.defaultRelease;
  const defaultName = selected?.manifest.builds.find((b) => b.image === "fido")?.usb.product_name ?? FALLBACK_DEFAULT_NAME;

  // The typed text survives switching between the three options (and Back/Continue through the persisted config).
  const [customText, setCustomText] = useState(config.name.mode === "custom" ? config.name.name : "");
  const mode = config.name.mode;
  // The content under the options changes with the choice; whatever is there when the stage opens rides on it.
  const revealMode = useChangedSinceMount(mode) ? "enter-reveal" : undefined;

  const chooseMode = (m: string) => {
    if (m === "custom") actions.setNameRequest({ mode: "custom", name: customText });
    else if (m === "keep" || m === "default") actions.setNameRequest({ mode: m });
  };
  const changeText = (value: string) => {
    setCustomText(value);
    actions.setNameRequest({ mode: "custom", name: value });
  };

  const openpgp = config.image === "openpgp";
  const nameInvalid = config.name.mode === "custom" && validateDeviceName(config.name.name) !== null;
  const previewName =
    config.name.mode === "custom"
      ? config.name.name || t.install.firmware.preview.custom
      : config.name.mode === "default"
        ? defaultName
        : t.install.firmware.preview.keep;
  const ids = vidPid(selected ?? undefined);

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
        <Button type="button" disabled={!selected || !hasImage(selected, config.image) || (!openpgp && nameInvalid)} onClick={actions.selectFirmware}>
          {t.common.continue}
        </Button>
      }
    >
      <FieldSet className="gap-3">
        <FieldLegend variant="label">
          {t.common.firmware}
        </FieldLegend>
        <FirmwareSection inst={inst} selected={selected} />
      </FieldSet>

      {!openpgp && (
        <>
          <Separator />
          <FieldSet className="gap-3">
            <FieldLegend variant="label">
              {t.install.firmware.personalize}
            </FieldLegend>
            <RadioGroup value={mode} onValueChange={chooseMode} className="grid gap-2 sm:grid-cols-3">
              {NAME_MODES.map((m) => (
                <FieldLabel key={m} htmlFor={`name-${m}`} className="transition-colors">
                  <Field orientation="horizontal" className="items-center">
                    <FieldContent>
                      <FieldTitle>{t.install.firmware.nameOptions[m].title}</FieldTitle>
                    </FieldContent>
                    <RadioGroupItem id={`name-${m}`} value={m} />
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
            <div key={mode} className={revealMode} aria-live="polite">
              {mode === "keep" && <FieldDescription>{t.install.firmware.nameHints.keep(defaultName)}</FieldDescription>}
              {mode === "default" && <FieldDescription>{t.install.firmware.nameHints.default(defaultName)}</FieldDescription>}
              {config.name.mode === "custom" && (
                <div className="flex flex-col gap-2">
                  <DeviceNameField id="device-name" value={config.name.name} onChange={changeText} defaultName={FALLBACK_DEFAULT_NAME} hideRestore />
                  <FieldDescription>{t.install.firmware.nameHints.custom}</FieldDescription>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3" data-testid="usb-preview">
              <Usb className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{previewName}</span>
                <span className="text-xs text-muted-foreground">{ids ? t.install.firmware.preview.vidPid(ids) : t.install.firmware.preview.title}</span>
              </div>
              <Badge variant="outline">{t.install.firmware.preview.notApplied}</Badge>
            </div>
          </FieldSet>
        </>
      )}
    </StageCard>
  );
}
