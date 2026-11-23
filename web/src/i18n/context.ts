import { createContext, useContext } from "react";
import type { Locale } from "./locale";
import { en, type Messages } from "./messages/en";

export interface I18n {
  locale: Locale;
  t: Messages;
  setLocale: (locale: Locale) => void;
}

// English without a provider, so components render in unit tests without wrapping them.
export const I18nContext = createContext<I18n>({ locale: "en", t: en, setLocale: () => {} });

export function useI18n(): I18n {
  return useContext(I18nContext);
}
