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

/** `5 s`, `3 min 5 s`, `2 h 5 min`: units that read the same in every supported language. */
export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) % 60;
  const s = seconds % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}
