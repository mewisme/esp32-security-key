import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { DrawnCheck } from "@/components/common/DrawnCheck";
import { Badge } from "@/components/reui/badge";
import { FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";
import type { Messages } from "@/i18n/messages/en";
import type { Build } from "@/lib/firmware/types";
import { profileById } from "@/lib/firmware/policy";
import { formatBytes } from "@/lib/format";

function verificationBadge(build: Build, t: Messages): { variant: "success-light" | "warning-light"; text: string } {
  if (build.verification === "hardware-verified") {
    return { variant: "success-light", text: `${t.support["hardware-verified"]} (${build.verified_hardware[0] ?? "ESP32-S3 N16R8"})` };
  }
  return { variant: "warning-light", text: t.support["build-verified"] };
}

function CopyHash({ sha256 }: { sha256: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">SHA-256</span>
      <code className="font-mono text-xs" title={sha256}>
        {sha256.slice(0, 12)}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
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
    </span>
  );
}

export function BuildPanel({ tag, build }: { tag: string; build: Build }) {
  const { t, locale } = useI18n();
  const profile = profileById(build.profile_id);
  const v = verificationBadge(build, t);
  return (
    <FramePanel>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-medium">{build.title}</span>
          <Badge variant="outline">{profile?.label ?? build.flash_size}</Badge>
          <Badge variant={v.variant}>{v.text}</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="tabular-nums">{formatBytes(build.package.size, locale)}</span>
            <CopyHash sha256={build.package.sha256} />
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/firmware/${encodeURIComponent(tag)}/${encodeURIComponent(build.package.name)}`} download={build.package.name}>
              <Download aria-hidden /> {t.common.download}
            </a>
          </Button>
        </div>
      </div>
    </FramePanel>
  );
}
