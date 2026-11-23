import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useI18n } from "@/i18n/context";
import { detectLocale, LOCALE_KEY, saveLocale, storedLocale } from "@/i18n/locale";
import { applyTheme, storedTheme } from "@/lib/theme";

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

describe("storage that is not available", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  /** localStorage whose every call throws, as when cookies and site data are blocked. */
  const blocked = () => {
    const boom = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
  };

  it("follows the browser's language instead of failing, and says the choice was not saved", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["vi-VN"]);
    blocked();
    expect(storedLocale()).toBe("vi");
    expect(saveLocale("en")).toBe(false);
  });

  it("still switches the language for the visit when it cannot be saved", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    blocked();
    function Probe() {
      const { locale, setLocale } = useI18n();
      return (
        <button type="button" onClick={() => setLocale("vi")}>
          {locale}
        </button>
      );
    }
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByRole("button").textContent).toBe("en");
    act(() => screen.getByRole("button").click());
    expect(screen.getByRole("button").textContent).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
  });

  it("the theme falls back to the system choice and still applies", () => {
    blocked();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(storedTheme()).toBe("system");
    expect(() => applyTheme("dark")).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    vi.unstubAllGlobals();
  });
});
