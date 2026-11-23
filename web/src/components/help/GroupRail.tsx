import { useRef } from "react";
import { Scrollspy } from "@/components/reui/scrollspy";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useI18n } from "@/i18n/context";
import type { ErrorGroup } from "@/lib/errors/catalog";
import { groupSlug } from "./group-slug";

/** Vertical sticky rail from `lg`; a horizontally scrollable link row below. Window scroll drives the active link. */
export function GroupRail({ groups }: { groups: ErrorGroup[] }) {
  const { t } = useI18n();
  // The installed Scrollspy scrolls smoothly by default and does not ask the OS; under reduced motion the jump is instant.
  const reducedMotion = usePrefersReducedMotion();
  const target = useRef<Document | null>(typeof document === "undefined" ? null : document);
  return (
    <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
      <Scrollspy targetRef={target} offset={80} history={false} smooth={!reducedMotion}>
        <nav aria-label={t.help.topics} className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {groups.map((g) => (
            <a
              key={g}
              href={`#${groupSlug(g)}`}
              data-scrollspy-anchor={groupSlug(g)}
              className="shrink-0 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:font-medium data-[active=true]:text-foreground"
            >
              {t.errorGroups[g]}
            </a>
          ))}
        </nav>
      </Scrollspy>
    </aside>
  );
}
