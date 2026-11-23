import { DOCS_URL, REPO_URL } from "@/lib/status";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>MultiKeys is experimental open-source software, licensed AGPL-3.0-or-later.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-4">
          <a className="transition-colors hover:text-foreground" href={DOCS_URL} target="_blank" rel="noreferrer">
            Documentation
          </a>
          <a className="transition-colors hover:text-foreground" href={REPO_URL} target="_blank" rel="noreferrer">
            Corresponding source
          </a>
          <a className="transition-colors hover:text-foreground" href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            License
          </a>
        </nav>
      </div>
    </footer>
  );
}
