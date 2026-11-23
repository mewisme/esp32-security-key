import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/reui/badge";
import { FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import type { Build } from "@/lib/firmware/types";
import { profileById } from "@/lib/firmware/policy";
import { formatBytes } from "@/lib/format";

function verificationBadge(build: Build): { variant: "success-light" | "warning-light"; text: string } {
  if (build.verification === "hardware-verified") {
    return { variant: "success-light", text: `Hardware verified (${build.verified_hardware[0] ?? "ESP32-S3 N16R8"})` };
  }
  return { variant: "warning-light", text: "Build verified — not hardware tested" };
}

function CopyHash({ sha256 }: { sha256: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
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
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

export function BuildPanel({ tag, build }: { tag: string; build: Build }) {
  const profile = profileById(build.profile_id);
  const v = verificationBadge(build);
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
            <span className="tabular-nums">{formatBytes(build.package.size)}</span>
            <CopyHash sha256={build.package.sha256} />
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/firmware/${encodeURIComponent(tag)}/${encodeURIComponent(build.package.name)}`} download={build.package.name}>
              <Download aria-hidden /> Download
            </a>
          </Button>
        </div>
      </div>
    </FramePanel>
  );
}
