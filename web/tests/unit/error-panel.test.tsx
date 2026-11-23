import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorPanel } from "@/components/flasher/ErrorPanel";
import { NO_BYPASS } from "@/lib/errors/catalog";

afterEach(cleanup);

describe("ErrorPanel", () => {
  it.each(NO_BYPASS)("offers no way to continue past %s", (code) => {
    render(
      <MemoryRouter>
        <ErrorPanel code={code} message="m" log={[]} onRetry={() => {}} onRestart={() => {}} />
      </MemoryRouter>,
    );
    for (const b of screen.getAllByRole("button")) {
      expect(b.textContent ?? "").not.toMatch(/continue|anyway|ignore|skip/i);
    }
  });
});
