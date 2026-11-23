import { afterEach, describe, expect, it, vi } from "vitest";
import { detectLocale, LOCALE_KEY, storedLocale } from "@/i18n/locale";

describe("detectLocale", () => {
  it("takes the first language of the list that the site has", () => {
    expect(detectLocale(["vi-VN", "en"])).toBe("vi");
    expect(detectLocale(["en-US", "vi"])).toBe("en");
    expect(detectLocale(["fr-FR", "vi", "en"])).toBe("vi");
  });

  it("falls back to English when no entry matches or the list is empty", () => {
    expect(detectLocale(["fr-FR", "de"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  it("matches the primary subtag, ignoring case and region", () => {
    expect(detectLocale(["VI"])).toBe("vi");
    expect(detectLocale(["vi-vn"])).toBe("vi");
    expect(detectLocale(["EN-gb"])).toBe("en");
  });
});

describe("storedLocale", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const browserSpeaks = (...languages: string[]) => vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);

  it("follows the browser when nothing was chosen, and does not save that guess", () => {
    browserSpeaks("vi-VN", "en");
    expect(storedLocale()).toBe("vi");
    expect(localStorage.getItem(LOCALE_KEY)).toBeNull();
  });

  it("prefers the saved choice over the browser's language", () => {
    browserSpeaks("en-US");
    localStorage.setItem(LOCALE_KEY, "vi");
    expect(storedLocale()).toBe("vi");
    browserSpeaks("vi-VN");
    localStorage.setItem(LOCALE_KEY, "en");
    expect(storedLocale()).toBe("en");
  });

  it("ignores a saved value that is not a language of the site", () => {
    browserSpeaks("vi-VN");
    localStorage.setItem(LOCALE_KEY, "de");
    expect(storedLocale()).toBe("vi");
  });
});
