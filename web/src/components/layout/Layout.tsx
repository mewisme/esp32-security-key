import { useEffect } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export function Layout() {
  const { t } = useI18n();
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  // A page entered by a link starts at its top (the header is sticky, so the link may be clicked far down the previous page).
  // Back and forward keep the browser's own position, and a hash is the page's to scroll to (pages/Help).
  useEffect(() => {
    if (navigationType !== "POP" && !hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash, navigationType]);

  return (
    <TooltipProvider>
      <div className="flex min-h-svh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-background focus:p-2">
          {t.layout.skipToContent}
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </TooltipProvider>
  );
}
