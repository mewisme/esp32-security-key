import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorPanel } from "@/components/flasher/ErrorPanel";
import { I18nContext } from "@/i18n/context";
import { MESSAGES } from "@/i18n/messages";
import { NO_BYPASS } from "@/lib/errors/catalog";

afterEach(cleanup);

describe.each(["en", "vi"] as const)("ErrorPanel in %s", (locale) => {
  it.each(NO_BYPASS)("offers no way to continue past %s", (code) => {
    render(
      <I18nContext.Provider value={{ locale, t: MESSAGES[locale], setLocale: () => {} }}>
        <MemoryRouter>
          <ErrorPanel code={code} message="m" log={[]} onRetry={() => {}} onRestart={() => {}} />
        </MemoryRouter>
      </I18nContext.Provider>,
    );
    for (const b of screen.getAllByRole("button")) {
      expect(b.textContent ?? "").not.toMatch(/continue|anyway|ignore|skip|tiếp tục|bỏ qua|vẫn/i);
    }
  });
});
