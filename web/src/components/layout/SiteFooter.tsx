import { useI18n } from "@/i18n/context";
import { DOCS_URL, REPO_URL } from "@/lib/status";

const LINK = "transition-colors hover:text-foreground";

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <p>{t.layout.footer.notice}</p>
        <nav aria-label={t.layout.footer.label} className="flex flex-wrap gap-x-4 gap-y-1">
          <a className={LINK} href={DOCS_URL} target="_blank" rel="noopener noreferrer">
            {t.layout.footer.documentation}
          </a>
          <a className={LINK} href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {t.layout.footer.source}
          </a>
          <a className={LINK} href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
            {t.layout.footer.license}
          </a>
        </nav>
      </div>
    </footer>
  );
}
