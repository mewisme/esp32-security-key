import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameHeader, FrameTitle } from "@/components/reui/frame";
import { useI18n } from "@/i18n/context";
import { buildsBySize, type CatalogRelease } from "@/lib/firmware/catalog";
import { BuildPanel } from "./BuildPanel";
import { formatDate } from "./format-date";

export function ReleaseFrame({ release: r }: { release: CatalogRelease }) {
  const { t, locale } = useI18n();
  return (
    <Frame spacing="default" id={`release-${r.tag}`}>
      <FrameHeader>
        <div className="flex flex-wrap items-center gap-2">
          <FrameTitle>{r.name}</FrameTitle>
          <Badge variant={r.prerelease ? "warning-light" : "success-light"}>{r.prerelease ? t.common.preRelease : t.common.stable}</Badge>
          <Badge variant="outline">{r.manifest.source_commit.slice(0, 12)}</Badge>
        </div>
        <FrameDescription>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{r.publishedAt ? formatDate(r.publishedAt, locale) : t.releases.unpublished}</span>
            {r.notesUrl && (
              <a
                className="inline-flex items-center gap-1 underline underline-offset-4 transition-colors hover:text-foreground"
                href={r.notesUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.common.releaseNotes} <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </span>
        </FrameDescription>
      </FrameHeader>
      {buildsBySize(r.manifest.builds).map((b) => (
        <BuildPanel key={b.id} tag={r.tag} build={b} />
      ))}
    </Frame>
  );
}
