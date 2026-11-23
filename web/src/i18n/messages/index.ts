import type { Locale } from "../locale";
import { en, type Messages } from "./en";
import { vi } from "./vi";

export type { Messages };

export const MESSAGES: Record<Locale, Messages> = { en, vi };
