import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline";
import { useI18n } from "@/i18n/context";
import type { CatalogRelease } from "@/lib/firmware/catalog";
import { formatDate } from "./format-date";

export function ReleaseTimeline({ releases }: { releases: CatalogRelease[] }) {
  const { t, locale } = useI18n();
  return (
    <Timeline defaultValue={releases.length} aria-label={t.releases.history}>
      {releases.map((r, i) => (
        <TimelineItem key={r.tag} step={i + 1}>
          <TimelineHeader>
            <TimelineDate dateTime={r.publishedAt ?? undefined}>{r.publishedAt ? formatDate(r.publishedAt, locale) : t.releases.unpublished}</TimelineDate>
            <TimelineTitle>{r.name}</TimelineTitle>
          </TimelineHeader>
          <TimelineIndicator />
          <TimelineSeparator />
          <TimelineContent>{r.prerelease ? t.common.preRelease : t.common.stable}</TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
