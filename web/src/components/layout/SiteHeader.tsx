import { KeyRound, Menu } from "lucide-react";
import { Link, NavLink } from "react-router";
import { GitHubIcon } from "@/components/common/GitHubIcon";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { REPO_URL } from "@/lib/status";
import { cn } from "cn";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { to: "/install", label: "Install" },
  { to: "/first-use", label: "First use" },
  { to: "/help", label: "Help" },
  { to: "/releases", label: "Releases" },
];

const ITEM =
  "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground dark:hover:bg-muted/50 dark:aria-[current=page]:bg-muted/50";

function NavItems({ vertical }: { vertical?: boolean }) {
  return (
    <>
      {LINKS.map((l) => (
        <NavLink key={l.to} to={l.to} className={cn(ITEM, vertical && "text-base")}>
          {l.label}
        </NavLink>
      ))}
      {vertical && (
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={cn(ITEM, "text-base")}>
          GitHub
        </a>
      )}
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:px-6">
        <Link to="/" className="mr-auto flex items-center gap-2 font-heading text-lg font-semibold">
          <KeyRound className="size-5 text-primary" aria-hidden />
          MultiKeys
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          <NavItems />
        </nav>
        <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub repository">
            <GitHubIcon />
          </a>
        </Button>
        <ThemeToggle />
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>MultiKeys</SheetTitle>
            </SheetHeader>
            <nav aria-label="Mobile" className="flex flex-col gap-1 px-2">
              <NavItems vertical />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
