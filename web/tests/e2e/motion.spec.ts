import { expect, type Page, test } from "@playwright/test";
import { HARDWARE_CHECK, setup } from "./helpers";

const main = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** Names of the CSS animations that are running. */
function running(page: Page): Promise<string[]> {
  return page.evaluate(() => document.getAnimations().map((a) => (a instanceof CSSAnimation ? a.animationName : "")));
}

/**
 * Names of the running animations that move something: a translate, scale, rotation, resize or drawn stroke in their
 * keyframes. Progress bars (the BOOT countdown) and chevrons keep moving under reduced motion by design.
 */
function movers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const moves = (transform: unknown) => {
      if (typeof transform !== "string" || transform === "none") return false;
      try {
        return !new DOMMatrix(transform).isIdentity;
      } catch {
        return true;
      }
    };
    const names: string[] = [];
    for (const a of document.getAnimations()) {
      const name = a instanceof CSSAnimation ? a.animationName : a instanceof CSSTransition ? a.transitionProperty : "";
      if (name === "countdown" || name === "rotate") continue;
      const frames = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
      const keys = new Set(frames.flatMap((k) => Object.keys(k)));
      if (["translate", "scale", "rotate", "height", "strokeDashoffset"].some((p) => keys.has(p)) || frames.some((k) => moves(k.transform))) names.push(name);
    }
    return names;
  });
}

/** Waits until the step's entrance runs, whichever form it takes: the movement, or the fade that replaces it. */
const entering = (page: Page, moving: string) =>
  expect.poll(async () => (await running(page)).some((n) => n === moving || n === "enter-fade")).toBe(true);

/** Walks a route change, a disclosure, a wizard stage and a menu, and reports what moved at each. */
async function walk(page: Page) {
  await setup(page, {});
  await page.goto("/help");
  const seen: Record<string, string[]> = {};

  await main(page).getByRole("link", { name: "Install" }).click();
  await entering(page, "enter-rise");
  seen.page = await movers(page);

  await page.getByRole("button", { name: "Not sure which board you have?" }).click();
  await expect(page.getByText("You don't have to know.")).toBeVisible();
  seen.disclosure = await movers(page);
  await page.getByRole("button", { name: "Not sure which board you have?" }).click();
  await expect(page.getByText("You don't have to know.")).toBeHidden();

  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await entering(page, "enter-from-right");
  seen.stage = await movers(page);

  await page.getByTestId("theme-toggle").click();
  await expect.poll(async () => (await running(page)).includes("enter")).toBe(true);
  seen.menu = await movers(page);
  return seen;
}

test("a page entered from a link starts at its top", async ({ page }) => {
  await setup(page, {});
  await page.setViewportSize({ width: 1100, height: 500 });
  await page.goto("/help");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  // First use is long and static, so the browser would keep a large offset if the page did not reset it.
  await main(page).getByRole("link", { name: "First use" }).click();
  await expect(page.getByRole("heading", { name: "First use", level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test.describe("motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  // The control for the reduced-motion test below: the same walk, and every step of it does move.
  test("a page, a disclosure, a stage and a menu each move", async ({ page }) => {
    const seen = await walk(page);
    for (const [step, names] of Object.entries(seen)) expect(names, step).not.toEqual([]);
  });

  test("a disclosure opens and closes", async ({ page }) => {
    await setup(page, {});
    await page.goto("/install");
    const trigger = page.getByRole("button", { name: "Not sure which board you have?" });
    await trigger.click();
    await expect(page.getByText("You don't have to know.")).toBeVisible();
    await trigger.click();
    await expect(page.getByText("You don't have to know.")).toBeHidden();
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  // Movement becomes a fade or an instant change, installed overlays included; nothing here may slide, zoom, grow or draw.
  test("nothing slides, zooms, grows or draws", async ({ page }) => {
    const seen = await walk(page);
    expect(seen).toEqual({ page: [], disclosure: [], stage: [], menu: [] });
  });

  test("a disclosure opens and closes", async ({ page }) => {
    await setup(page, {});
    await page.goto("/install");
    const trigger = page.getByRole("button", { name: "Not sure which board you have?" });
    await trigger.click();
    await expect(page.getByText("You don't have to know.")).toBeVisible();
    await trigger.click();
    await expect(page.getByText("You don't have to know.")).toBeHidden();
  });
});
