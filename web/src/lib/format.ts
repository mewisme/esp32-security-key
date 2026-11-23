import { INTL_LOCALE, type Locale } from "../i18n/locale";

const BYTES: Record<Locale, string> = { en: "bytes", vi: "byte" };

/** A plain number in the language's notation (decimal comma in Vietnamese), without thousands separators. */
function plain(n: number, locale: Locale, fractionDigits: number): string {
  return n.toLocaleString(INTL_LOCALE[locale], {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: false,
  });
}

export function formatBytes(n: number, locale: Locale): string {
  if (n >= 1024 * 1024) return `${plain(n / 1024 / 1024, locale, 1)} MB`;
  if (n >= 1024) return `${plain(Math.round(n / 1024), locale, 0)} KB`;
  return `${plain(n, locale, 0)} ${BYTES[locale]}`;
}

export function formatHex(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(5, "0")}`;
}
