import { useEffect } from "react";
import { useLocation } from "react-router";
import { ERROR_GROUPS, ERRORS, type ErrorCode } from "@/lib/errors/catalog";

export function HelpPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  const codes = Object.keys(ERRORS) as ErrorCode[];
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-10">
      <h1 className="text-3xl font-semibold">Help</h1>
      {ERROR_GROUPS.map((g) => (
        <section key={g} aria-labelledby={`g-${g}`} className="space-y-6">
          <h2 id={`g-${g}`} className="text-xl font-semibold">
            {g}
          </h2>
          {codes
            .filter((c) => ERRORS[c].group === g)
            .map((c) => (
              <article key={c} id={c} className="scroll-mt-20 space-y-2 rounded-lg border p-4 target:border-primary">
                <h3 className="font-medium">{ERRORS[c].title}</h3>
                <p className="text-muted-foreground">{ERRORS[c].what}</p>
                <ol className="list-decimal space-y-1 pl-5">
                  {ERRORS[c].next.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ol>
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}
