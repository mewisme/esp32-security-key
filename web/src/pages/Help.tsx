import { useEffect } from "react";
import { useLocation } from "react-router";
import { GroupRail } from "@/components/help/GroupRail";
import { groupSlug } from "@/components/help/group-slug";
import { Page } from "@/components/layout/Page";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { useI18n } from "@/i18n/context";
import { ERROR_GROUPS, ERRORS, type ErrorCode } from "@/lib/errors/catalog";

export function HelpPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);
  const codes = Object.keys(ERRORS) as ErrorCode[];
  const { t } = useI18n();
  return (
    <Page width="wide">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{t.help.title}</h1>
        <p className="text-muted-foreground">{t.help.lead}</p>
      </header>
      <div className="flex min-w-0 flex-col gap-6 lg:grid lg:grid-cols-[14rem_1fr] lg:gap-8">
        <GroupRail groups={ERROR_GROUPS} />
        <div className="flex min-w-0 flex-col gap-8">
          {ERROR_GROUPS.map((g) => (
            <section key={g} id={groupSlug(g)} aria-labelledby={`${groupSlug(g)}-h`} className="scroll-mt-20">
              <Frame spacing="default">
                <FrameHeader>
                  <h2 id={`${groupSlug(g)}-h`} className="text-lg font-semibold">
                    {t.errorGroups[g]}
                  </h2>
                </FrameHeader>
                {codes
                  .filter((c) => ERRORS[c].group === g)
                  .map((c) => (
                    <FramePanel key={c} id={c} className="scroll-mt-20 target:ring-2 target:ring-primary">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <FrameTitle>{t.errors[c].title}</FrameTitle>
                          <FrameDescription>{t.errors[c].what}</FrameDescription>
                        </div>
                        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
                          {t.errors[c].next.map((n) => (
                            <li key={n}>{n}</li>
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
    </Page>
  );
}
