import { DOCS_URL, REPO_URL } from "@/lib/status";

const LINK = "transition-colors hover:text-foreground";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <p>MultiKeys is experimental open-source software, licensed AGPL-3.0-or-later.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
          <a className={LINK} href={DOCS_URL} target="_blank" rel="noopener noreferrer">
            Documentation
          </a>
          <a className={LINK} href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Corresponding source
          </a>
          <a className={LINK} href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
            License
          </a>
        </nav>
      </div>
    </footer>
  );
}
