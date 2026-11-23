import { INTL_LOCALE, type Locale } from "@/i18n/locale";

export function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(INTL_LOCALE[locale]);
}
