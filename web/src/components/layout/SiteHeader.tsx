import { KeyRound, Menu } from "lucide-react";
import { Link, NavLink } from "react-router";
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

function NavItems({ vertical }: { vertical?: boolean }) {
  return (
    <>
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
              isActive ? "font-medium text-foreground" : "text-muted-foreground",
              vertical && "text-base",
            )
          }
        >
          {l.label}
        </NavLink>
      ))}
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        className={cn("rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground", vertical && "text-base")}
      >
        GitHub
      </a>
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <Link to="/" className="mr-auto flex items-center gap-2 font-heading text-lg font-semibold">
          <KeyRound className="size-5 text-primary" aria-hidden />
          MultiKeys
        </Link>
        <nav aria-label="Main" className="hidden items-center md:flex">
          <NavItems />
        </nav>
        <ThemeToggle />
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>MultiKeys</SheetTitle>
            </SheetHeader>
            <nav aria-label="Main" className="flex flex-col px-2">
              <NavItems vertical />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
