import { KeyRound, Menu } from "lucide-react";
import { Link, NavLink } from "react-router";
import { GitHubIcon } from "@/components/common/GitHubIcon";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "@/i18n/context";
import { REPO_URL } from "@/lib/status";
import { cn } from "cn";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { to: "/install", key: "install" },
  { to: "/first-use", key: "firstUse" },
  { to: "/passkeys", key: "passkeys" },
  { to: "/key", key: "keyInfo" },
  { to: "/help", key: "help" },
  { to: "/releases", key: "releases" },
] as const;

const ITEM =
  "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground dark:hover:bg-muted/50 dark:aria-[current=page]:bg-muted/50";

function NavItems({ vertical }: { vertical?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {LINKS.map((l) => (
        <NavLink key={l.to} to={l.to} className={cn(ITEM, vertical && "text-base")}>
          {t.layout.nav[l.key]}
        </NavLink>
      ))}
      {vertical && (
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={cn(ITEM, "text-base")}>
          {t.layout.github}
        </a>
      )}
    </>
  );
}

export function SiteHeader() {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:px-6">
        <Link to="/" className="mr-auto flex items-center gap-2 font-heading text-lg font-semibold transition-colors hover:text-primary">
          <KeyRound className="size-5 text-primary" aria-hidden />
          MultiKeys
        </Link>
        <nav aria-label={t.layout.mainNav} className="hidden items-center gap-1 lg:flex">
          <NavItems />
        </nav>
        <Button asChild variant="ghost" size="icon" className="hidden lg:inline-flex">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={t.layout.githubRepository}>
            <GitHubIcon />
          </a>
        </Button>
        <LanguageToggle />
        <ThemeToggle />
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="lg:hidden" aria-label={t.layout.openMenu}>
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>MultiKeys</SheetTitle>
            </SheetHeader>
            <nav aria-label={t.layout.mobileNav} className="flex flex-col gap-1 px-2">
              <NavItems vertical />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
