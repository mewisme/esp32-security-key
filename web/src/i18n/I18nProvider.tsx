import { type ReactNode, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { I18nContext } from "./context";
import { type Locale, saveLocale, storedLocale } from "./locale";
import { MESSAGES } from "./messages";

/** Holds the language, saves an explicit choice, and keeps <html lang>, the title and the description in step with it. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setState] = useState<Locale>(storedLocale);

  const setLocale = useCallback((next: Locale) => {
    saveLocale(next); // an unavailable storage only means the choice is not remembered
    setState(next);
  }, []);

  useLayoutEffect(() => {
    const { meta } = MESSAGES[locale];
    document.documentElement.lang = locale;
    document.title = meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", meta.description);
  }, [locale]);

  const value = useMemo(() => ({ locale, t: MESSAGES[locale], setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
