import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { DrawnCheck } from "@/components/common/DrawnCheck";
import { Spinner } from "@/components/common/Spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { BuildState } from "@/hooks/useKeyDevice";
import type { CatalogState } from "@/hooks/useInstaller";
import { useI18n } from "@/i18n/context";
import { matchPublished } from "@/lib/device/build-match";
import { type BuildInfo, chipModelName, resetReasonName } from "@/lib/device/mkauth";
import { formatUptime } from "@/lib/format";

function CopyHash({ value }: { value: string }) {
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
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? (
        <span className="enter-reveal inline-flex items-center gap-1">
          <DrawnCheck className="size-3.5" />
          {t.keyInfo.firmware.copied}
        </span>
      ) : (
        t.keyInfo.firmware.copy
      )}
    </Button>
  );
}

function Published({ info, catalog }: { info: BuildInfo; catalog: CatalogState }) {
  const { t } = useI18n();
  const p = t.keyInfo.published;
  const matches = useMemo(
    () => (catalog.status === "ready" && info.imageSha256 ? matchPublished(info.imageSha256, catalog.catalog.releases) : []),
    [catalog, info.imageSha256],
  );
  if (!info.imageSha256) return null;
  if (catalog.status === "loading") return <Badge variant="outline" className="self-start">{p.checking}</Badge>;
  if (catalog.status === "error") return <p className="text-sm text-muted-foreground">{p.catalogFailed}</p>;
  const first = matches[0];
  if (first) {
    return (
      <Badge variant="success-light" className="self-start" data-testid="published-match">
        {p.matches(first.tag, first.flashSize)}
      </Badge>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="warning-light" className="self-start" data-testid="published-no-match">
        {p.noMatch}
      </Badge>
      <p className="text-sm text-muted-foreground">{p.noMatchHint}</p>
    </div>
  );
}

function Details({ info }: { info: BuildInfo }) {
  const { t } = useI18n();
  const f = t.keyInfo.firmware;
  const onOff = (v: boolean | undefined) => (v === undefined ? f.notReported : v ? f.on : f.off);
  const dirty = info.commit?.endsWith("+dirty") === true;
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: f.rows.firmware,
      value: (
        <span lang="en">
          {info.project ?? "?"} {info.version ?? "?"} (ESP-IDF {info.idfVersion ?? "?"})
        </span>
      ),
    },
    {
      label: f.rows.commit,
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-xs" lang="en">
            {info.commit ?? "?"}
          </code>
          {dirty && <Badge variant="warning-light">{f.dirty}</Badge>}
        </span>
      ),
    },
  ];
  if (info.imageSha256) {
    rows.push({
      label: f.rows.image,
      value: (
        <span className="flex flex-wrap items-center gap-x-2">
          <code className="font-mono text-xs break-all" data-testid="image-sha256">
            {info.imageSha256}
          </code>
          <CopyHash value={info.imageSha256} />
        </span>
      ),
    });
  }
  if (info.flashBuiltFor !== undefined || info.flashChipBytes !== undefined) {
    const chipFlash = info.flashChipBytes === undefined ? f.notReported : `${info.flashChipBytes / (1024 * 1024)} MB`;
    rows.push({ label: f.rows.flash, value: f.flash(info.flashBuiltFor ?? f.notReported, chipFlash) });
  }
  if (info.chipModel !== undefined) {
    const rev = info.chipRevision === undefined ? "?" : `${Math.floor(info.chipRevision / 100)}.${String(info.chipRevision % 100).padStart(2, "0")}`;
    rows.push({ label: f.rows.chip, value: f.chip(chipModelName(info.chipModel) ?? `#${info.chipModel}`, rev, info.chipCores ?? 0) });
  }
  if (info.flashEncryption !== undefined || info.secureBoot !== undefined) {
    rows.push({ label: f.rows.security, value: f.security(onOff(info.flashEncryption), onOff(info.secureBoot)) });
  }
  if (info.resetReason !== undefined && info.uptimeSeconds !== undefined) {
    rows.push({ label: f.rows.boot, value: f.boot(resetReasonName(info.resetReason) ?? `#${info.resetReason}`, formatUptime(info.uptimeSeconds)) });
  }
  if (info.partitionLabel !== undefined && info.partitionOffset !== undefined) {
    rows.push({
      label: f.rows.partition,
      value: (
        <span lang="en">
          {info.partitionLabel} @ 0x{info.partitionOffset.toString(16)}
        </span>
      ),
    });
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FirmwareCard({ build, catalog, onReadAgain }: { build: BuildState; catalog: CatalogState; onReadAgain: () => void }) {
  const { t } = useI18n();
  const f = t.keyInfo.firmware;
  return (
    <Card data-testid="firmware-card">
      <CardHeader>
        <CardTitle>{f.title}</CardTitle>
        <CardDescription>{f.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {build.status === "reading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner className="size-4" />
            {f.reading}
          </p>
        )}
        {build.status === "outdated" && (
          <Alert variant="warning" data-testid="firmware-outdated">
            <TriangleAlert aria-hidden />
            <AlertTitle>{f.outdatedTitle}</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col items-start gap-2">
                <p>{f.outdatedBody}</p>
                <Link className="underline underline-offset-4 transition-colors hover:text-primary" to="/install">
                  {f.installLink}
                </Link>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {build.status === "failed" && (
          <Alert variant="destructive" role="alert">
            <TriangleAlert aria-hidden />
            <AlertTitle>{f.failedTitle}</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-2">
                <p>{f.failedBody}</p>
                <p lang="en" className="font-mono text-xs">
                  {build.detail}
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {build.status === "ok" && (
          <>
            <Published info={build.info} catalog={catalog} />
            <Details info={build.info} />
          </>
        )}
      </CardContent>
      {(build.status === "ok" || build.status === "outdated" || build.status === "failed") && (
        <CardFooter>
          <Button type="button" variant="outline" size="sm" onClick={onReadAgain}>
            {f.readAgain}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
