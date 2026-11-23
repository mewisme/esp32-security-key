import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { AsyncState } from "@/components/common/AsyncState";
import { GroupRail } from "@/components/help/GroupRail";
import { groupSlug } from "@/components/help/group-slug";
import { Page } from "@/components/layout/Page";
import { PageHeader } from "@/components/layout/PageHeader";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { useI18n } from "@/i18n/context";
import { ERROR_GROUPS, ERRORS, type ErrorCode } from "@/lib/errors/catalog";

/** Lower-case, accent-free text, so "khong tim thay" finds "Không tìm thấy". */
function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .toLowerCase();
}

export function HelpPage() {
  const { hash } = useLocation();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);
  const { t } = useI18n();
  const shown = useMemo(() => {
    const words = plain(query).split(/\s+/).filter(Boolean);
    return (Object.keys(ERRORS) as ErrorCode[]).filter((c) => {
      const e = t.errors[c];
      const text = plain([c, e.title, e.what, ...e.next].join(" "));
      return words.every((w) => text.includes(w));
    });
  }, [query, t]);
  const groups = ERROR_GROUPS.filter((g) => shown.some((c) => ERRORS[c].group === g));
  return (
    <Page width="wide">
      <PageHeader title={t.help.title} description={t.help.lead} />
      <div className="flex min-w-0 flex-col gap-2">
        <InputGroup className="max-w-md">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.help.search.placeholder} aria-label={t.help.search.label} />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="button" variant="ghost" size="icon-xs" aria-label={t.help.search.clear} onClick={() => setQuery("")}>
                <X aria-hidden />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <p className="text-sm text-muted-foreground" role="status">
          {query ? t.help.search.results(shown.length) : null}
        </p>
      </div>
      {groups.length === 0 ? (
        <AsyncState
          state="empty"
          title={t.help.search.emptyTitle}
          description={t.help.search.emptyText}
          icon={<Search aria-hidden />}
          action={
            <Button type="button" variant="outline" onClick={() => setQuery("")}>
              {t.help.search.clear}
            </Button>
          }
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-6 lg:grid lg:grid-cols-[14rem_1fr] lg:gap-8">
          <GroupRail groups={groups} />
          <div className="flex min-w-0 flex-col gap-8">
            {groups.map((g) => (
              <section key={g} id={groupSlug(g)} aria-labelledby={`${groupSlug(g)}-h`} className="scroll-mt-20">
                <Frame spacing="default">
                  <FrameHeader>
                    <h2 id={`${groupSlug(g)}-h`} className="text-lg font-semibold">
                      {t.errorGroups[g]}
                    </h2>
                  </FrameHeader>
                  {shown
                    .filter((c) => ERRORS[c].group === g)
                    .map((c) => (
                      <FramePanel key={c} id={c} className="scroll-mt-20 target:ring-2 target:ring-primary">
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <FrameTitle>{t.errors[c].title}</FrameTitle>
                            <FrameDescription>{t.errors[c].what}</FrameDescription>
                          </div>
                          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
                            {t.errors[c].next.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ol>
                        </div>
                      </FramePanel>
                    ))}
                </Frame>
              </section>
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
