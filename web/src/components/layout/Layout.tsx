import { Outlet } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export function Layout() {
  const { t } = useI18n();
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
