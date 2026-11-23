import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useI18n } from "@/i18n/context";

export interface DetailRow {
  label: string;
  value: string;
  /** A long unbroken value (a hash, a path): shown in the monospace face and broken anywhere. */
  technical?: boolean;
}

/**
 * Identity and diagnostic values behind one disclosure: labels are translated, values stay English (`lang="en"`).
 * Rows are keyed by position in the caller's list, never by text, so a language change cannot remount them.
 */
export function TechnicalDetails({ rows }: { rows: DetailRow[] }) {
  const { t } = useI18n();
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
        {t.common.technicalDetails}
      </CollapsibleTrigger>
      <CollapsibleContent className="collapse-content pt-3">
        <dl className="grid min-w-0 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
          {rows.map((r, i) => (
            <div key={i} className="contents">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className={r.technical ? "font-mono text-xs break-all" : "break-words"} lang="en">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
