import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline";
import type { CatalogRelease } from "@/lib/firmware/catalog";
import { formatDate } from "./format-date";

export function ReleaseTimeline({ releases }: { releases: CatalogRelease[] }) {
  return (
    <Timeline defaultValue={releases.length} aria-label="Release history">
      {releases.map((r, i) => (
        <TimelineItem key={r.tag} step={i + 1}>
          <TimelineHeader>
            <TimelineDate dateTime={r.publishedAt ?? undefined}>{formatDate(r.publishedAt)}</TimelineDate>
            <TimelineTitle>{r.name}</TimelineTitle>
          </TimelineHeader>
          <TimelineIndicator />
          <TimelineSeparator />
          <TimelineContent>{r.prerelease ? "Pre-release" : "Stable"}</TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
