import { Cpu, Download, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { DrawnCheck } from "@/components/common/DrawnCheck";
import { ReleaseBadges } from "@/components/installer/FirmwareStage";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/context";
import type { Messages } from "@/i18n/messages/en";
import type { Catalog } from "@/lib/firmware/catalog";
import { profileById } from "@/lib/firmware/policy";
import {
  type DownloadChoice,
  downloadUrl,
  findBuild,
  type Image,
  imagesInCatalog,
  megabytes,
  releaseWith,
  sizesInCatalog,
} from "@/lib/firmware/release-select";
import type { Build } from "@/lib/firmware/types";
import { formatBytes } from "@/lib/format";
import { formatDate } from "./format-date";

function verificationBadge(build: Build, t: Messages): { variant: "success-light" | "warning-light"; text: string } {
  if (build.verification === "hardware-verified") {
    return { variant: "success-light", text: `${t.support["hardware-verified"]} (${build.verified_hardware[0] ?? "ESP32-S3 N16R8"})` };
  }
  return { variant: "warning-light", text: t.support["build-verified"] };
}

function CopySha({ sha256 }: { sha256: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={t.releases.copySha}
      onClick={() => {
        void navigator.clipboard.writeText(sha256).then(() => setCopied(true));
      }}
    >
      {copied ? (
        <span className="enter-reveal inline-flex items-center gap-1">
          <DrawnCheck className="size-3.5" />
          {t.releases.copied}
        </span>
      ) : (
        t.releases.copy
      )}
    </Button>
  );
}

function TechnicalDetails({ build }: { build: Build }) {
  const { t } = useI18n();
  const d = t.releases.details;
  const rows: [string, string][] = [
    [d.board, build.board],
    [d.chip, build.chip],
    [d.flash, `${build.flash_size} · ${build.flash_mode} · ${build.flash_freq}`],
    [d.psram, build.psram_required ? d.psramRequired : d.psramOptional],
    [d.idf, build.idf_version],
    [d.usb, `${build.usb.vid.toString(16).padStart(4, "0")}:${build.usb.pid.toString(16).padStart(4, "0")}`],
    [d.layout, build.layout_id],
    [d.presence, `GPIO${build.user_presence.gpio}${build.user_presence.active_low ? " (active low)" : ""}`],
    [d.manifest, build.legacy ? d.schemaLegacy : d.schemaCurrent],
  ];
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
        {t.common.technicalDetails}
      </CollapsibleTrigger>
      <CollapsibleContent className="collapse-content pt-3">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">{d.sha256}</dt>
          <dd className="font-mono text-xs break-all" lang="en">
            {build.package.sha256}
          </dd>
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words" lang="en">
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Pick a firmware type, flash size and version from the catalog; the one matching artifact is shown with its real manifest data. */
export function FirmwareDownloads({
  catalog,
  choice,
  onChoice,
}: {
  catalog: Catalog;
  choice: DownloadChoice;
  onChoice: (c: DownloadChoice) => void;
}) {
  const { t, locale } = useI18n();
  const uid = useId();
  const images = imagesInCatalog(catalog);
  const sizes = sizesInCatalog(catalog, choice.image);
  const release = catalog.releases.find((r) => r.tag === choice.tag);
  const latestStableTag = catalog.releases.find((r) => !r.prerelease)?.tag;
  const build = release ? findBuild(release, choice.image, choice.flashSize) : null;
  const imageName = t.releases.imageNames[choice.image];
  const sizeName = `${megabytes(choice.flashSize)} MB`;
  const alternative = build ? null : releaseWith(catalog, choice.image, choice.flashSize, choice.tag);

  const setImage = (image: Image) => {
    const next = sizesInCatalog(catalog, image);
    onChoice({ ...choice, image, flashSize: next.includes(choice.flashSize) ? choice.flashSize : (next[next.length - 1] ?? choice.flashSize) });
  };

  return (
    <section id="downloads" className="flex scroll-mt-20 flex-col gap-4" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="text-xl font-semibold">
        {t.releases.downloadsTitle}
      </h2>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <span id={`${uid}-type`} className="text-xs text-muted-foreground">
            {t.releases.firmwareType}
          </span>
          <Tabs value={choice.image} onValueChange={(v) => setImage(v as Image)}>
            <TabsList aria-labelledby={`${uid}-type`}>
              {images.map((i) => (
                <TabsTrigger key={i} value={i}>
                  {t.releases.imageNames[i]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id={`${uid}-size`} className="text-xs text-muted-foreground">
            {t.releases.flashSize}
          </span>
          <Tabs value={choice.flashSize} onValueChange={(v) => onChoice({ ...choice, flashSize: v })}>
            <TabsList aria-labelledby={`${uid}-size`}>
              {sizes.map((s) => (
                <TabsTrigger key={s} value={s}>
                  {megabytes(s)} MB
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <Field className="w-full sm:w-72">
          <Label htmlFor={`${uid}-version`} className="text-xs text-muted-foreground">
            {t.releases.version}
          </Label>
          <Select value={choice.tag} onValueChange={(tag) => onChoice({ ...choice, tag })}>
            <SelectTrigger id={`${uid}-version`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {catalog.releases.map((r) => (
                  <SelectItem key={r.tag} value={r.tag}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium tabular-nums">v{r.manifest.version}</span>
                      <ReleaseBadges release={r} latestStable={r.tag === latestStableTag} />
                      {r.publishedAt && <span className="text-xs text-muted-foreground">{formatDate(r.publishedAt, locale)}</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {build && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertDescription>{t.experimental.text}</AlertDescription>
        </Alert>
      )}

      {build ? (
        <div className="flex flex-col gap-3">
          <Item variant="outline">
            <ItemMedia variant="icon">
              <Cpu aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="flex-wrap">
                {build.title}
                <Badge variant="outline">{profileById(build.profile_id)?.label ?? build.flash_size}</Badge>
                <Badge variant={verificationBadge(build, t).variant}>{verificationBadge(build, t).text}</Badge>
              </ItemTitle>
              <ItemDescription className="font-mono text-xs break-all" lang="en">
                {build.package.name}
              </ItemDescription>
              <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(build.package.size, locale)}</span>
            </ItemContent>
            <ItemActions>
              <Button asChild size="sm">
                <a href={downloadUrl(choice.tag, build)} download={build.package.name}>
                  <Download aria-hidden /> {t.common.download}
                </a>
              </Button>
              <CopySha sha256={build.package.sha256} />
            </ItemActions>
          </Item>
          <TechnicalDetails build={build} />
        </div>
      ) : (
        <Alert variant="info" role="status">
          <AlertDescription>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                {alternative ? t.releases.notAvailable(imageName, sizeName, choice.tag) : t.releases.noReleaseHas(imageName, sizeName)}
              </span>
              {alternative && (
                <Button type="button" variant="outline" size="sm" onClick={() => onChoice({ ...choice, tag: alternative.tag })}>
                  {t.releases.showRelease(alternative.tag)}
                </Button>
              )}
            </span>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
