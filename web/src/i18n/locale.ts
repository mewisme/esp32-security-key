// Which language the site speaks. No React and no dictionaries in here, so any module (including src/lib) can import it.
export type Locale = "en" | "vi";

export const LOCALES: readonly Locale[] = ["en", "vi"];

export const LOCALE_KEY = "multikeys-locale";

/** BCP 47 tag handed to Intl for numbers and dates. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", vi: "vi-VN" };

/** The first language of the browser's preference list that the site has; English when none matches. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const primary = language.toLowerCase().split("-")[0];
    if (primary === "vi") return "vi";
    if (primary === "en") return "en";
  }
  return "en";
}

/**
 * The language chosen with the toggle; without a choice, the browser's. Detection is never written to storage.
 * Storage can be unavailable (blocked cookies, some private modes): then there is no saved choice and the browser decides.
 */
export function storedLocale(): Locale {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LOCALE_KEY);
  } catch {
    // storage is blocked: follow the browser
  }
  if (stored === "en" || stored === "vi") return stored;
  return detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

/** Saves an explicit choice. False when storage is unavailable: the language still changes, for this visit only. */
export function saveLocale(locale: Locale): boolean {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}
