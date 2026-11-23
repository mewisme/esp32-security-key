import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "@/components/layout/Layout";
import { Page } from "@/components/layout/Page";
import { useI18n } from "@/i18n/context";
import { I18nProvider } from "@/i18n/I18nProvider";
import { applyTheme, storedTheme } from "@/lib/theme";
import { FirstUsePage } from "@/pages/FirstUse";
import { HelpPage } from "@/pages/Help";
import { HomePage } from "@/pages/Home";
import { NotFoundPage } from "@/pages/NotFound";
import { PasskeyLabPage } from "@/pages/PasskeyLab";
import { ReleasesPage } from "@/pages/Releases";
import "./styles/index.css";

// The installer pulls in esptool-js; keep it out of the landing page bundle.
const InstallPage = lazy(() => import("@/pages/Install").then((m) => ({ default: m.InstallPage })));

function InstallFallback() {
  const { t } = useI18n();
  return (
    <Page width="flow" enter={false}>
      <p className="text-muted-foreground" role="status">
        {t.install.loading}
      </p>
    </Page>
  );
}

applyTheme(storedTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route
              path="install"
              element={
                <Suspense fallback={<InstallFallback />}>
                  <InstallPage />
                </Suspense>
              }
            />
            <Route path="first-use" element={<FirstUsePage />} />
            <Route path="passkeys" element={<PasskeyLabPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="releases" element={<ReleasesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);
