import { expect, type Page, test } from "@playwright/test";
import { keyWrites, setup } from "./helpers";

test("theme toggle switches the dark class", async ({ page }) => {
  await setup(page, {});
  await page.goto("/");
  await page.getByTestId("theme-toggle").click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByTestId("theme-toggle").click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("language toggle switches the page to Vietnamese and remembers it", async ({ page }) => {
  await setup(page, {});
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", "en");
  await page.getByTestId("language-toggle").click();
  await page.getByRole("menuitemradio", { name: "Tiếng Việt" }).click();
  await expect(html).toHaveAttribute("lang", "vi");
  await expect(page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Cài đặt" })).toBeVisible();
  await page.reload();
  await expect(html).toHaveAttribute("lang", "vi");
  await page.getByTestId("language-toggle").click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(html).toHaveAttribute("lang", "en");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Install" })).toBeVisible();
});

const ROUTES = ["/", "/install", "/update", "/first-use", "/passkeys", "/key", "/help", "/releases", "/nope"];

/**
 * The page fits its width, its heading is visible and on top, and nothing in the page body sticks out of the
 * screen (content inside a box that scrolls on purpose, such as the stepper row, is exempt).
 */
async function expectLayoutHolds(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const report = await page.evaluate(() => {
    const width = window.innerWidth;
    const scrolls = (el: Element) => {
      for (let p: Element | null = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
      }
      return false;
    };
    const stuckOut: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if ((r.right > width + 1 || r.left < -1) && !scrolls(el)) stuckOut.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    const h1 = document.querySelector("h1");
    let covered = true;
    if (h1) {
      const r = h1.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + Math.min(r.width, 40) / 2, r.top + r.height / 2);
      covered = !(top && h1.contains(top));
    }
    return { scrollWidth: document.documentElement.scrollWidth, width, stuckOut: stuckOut.slice(0, 5), hasH1: !!h1, covered };
  });
  expect(report.scrollWidth, `${path} page width`).toBeLessThanOrEqual(report.width);
  expect(report.stuckOut, `${path} elements outside the screen`).toEqual([]);
  expect(report.hasH1, `${path} has a heading`).toBe(true);
  expect(report.covered, `${path} heading is covered`).toBe(false);
}

for (const locale of ["en-US", "vi-VN"] as const) {
  test.describe(`layout in ${locale}`, () => {
    test.use({ locale });
    for (const scheme of ["light", "dark"] as const) {
      for (const width of [360, 375, 768, 1280, 1440]) {
        test(`${scheme}, ${width}px: every page fits and shows its heading`, async ({ page }) => {
          test.setTimeout(60_000);
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({ width, height: 900 });
          await setup(page, {});
          for (const path of ROUTES) await expectLayoutHolds(page, path);
        });
      }
    }
  });
}

test("the site header links to every page and marks the current one", async ({ page }) => {
  await setup(page, {});
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/releases");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Releases" })).toHaveAttribute("aria-current", "page");
  for (const name of ["Install", "First use", "Help"]) await expect(nav.getByRole("link", { name })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "GitHub repository" })).toHaveAttribute("href", /github\.com\/mewisme\/esp32-security-key/);
});

test("on a phone the menu opens a sheet with the same links", async ({ page }) => {
  await setup(page, {});
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  const sheet = page.getByRole("dialog");
  for (const name of ["Install", "First use", "Help", "Releases", "GitHub"]) await expect(sheet.getByRole("link", { name })).toBeVisible();
});

test("home states the development-firmware warning and the tested hardware", async ({ page }) => {
  await setup(page, {});
  await page.goto("/");
  await expect(page.getByText("Don't use it as your only key.").first()).toBeVisible();
  await expect(page.getByText("Hardware verified on ESP32-S3 N16R8").first()).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Octal-flash modules");
});

test("an unknown error code in the Help hash scrolls its panel into view", async ({ page }) => {
  await setup(page, {});
  await page.goto("/help#unknown-flash-size");
  await expect(page.locator("#unknown-flash-size")).toBeInViewport();
  await expect(page.locator("#unknown-flash-size")).toContainText("The flash size couldn't be read");
});

test.describe("First use", () => {
  test("step 4 sends you to the Your key page", async ({ page }) => {
    await setup(page, {});
    await page.goto("/first-use");
    await expect(page.getByText("Landing page")).toHaveCount(0);
    await page.getByRole("link", { name: "Open Your key" }).click();
    await expect(page).toHaveURL(/\/key$/);
  });

  test("renames the key and resets it to the default name", async ({ page }) => {
    await setup(page, {});
    await page.goto("/first-use");
    await page.getByLabel("Device name").fill("Desk key");
    await page.getByRole("button", { name: "Apply name" }).click();
    await expect(page.getByText("Applied and verified: Desk key")).toBeVisible();
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByText("Applied and verified: MultiKeys Security Key")).toBeVisible();
    expect(await keyWrites(page)).toEqual([{ op: "set", name: "Desk key" }, { op: "clear" }]);
  });

  test("does not offer an invalid name", async ({ page }) => {
    await setup(page, {});
    await page.goto("/first-use");
    await page.getByLabel("Device name").fill("Mêw");
    await expect(page.getByText("Use plain ASCII letters, digits, spaces and punctuation only (no accents or emoji).")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply name" })).toBeDisabled();
  });

  test("asks for the management PIN when the key has one", async ({ page }) => {
    await setup(page, { key: { enrolledPin: "123456" } });
    await page.goto("/first-use");
    await page.getByLabel("Device name").fill("Desk key");
    await page.getByRole("button", { name: "Apply name" }).click();
    await page.getByLabel("Management PIN").fill("123456");
    await page.getByRole("button", { name: "Send PIN" }).click();
    await expect(page.getByText("Applied and verified: Desk key")).toBeVisible();
  });
});

test.describe("Vietnamese browser", () => {
  test.use({ locale: "vi-VN" });

  test("a first visit follows the browser's language without saving a choice", async ({ page }) => {
    await setup(page, {});
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    await expect(page).toHaveTitle(/cài đặt khóa bảo mật/);
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Cài đặt" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("multikeys-locale"))).toBeNull();
  });

  test("an explicit choice of English wins over the browser's language", async ({ page }) => {
    await setup(page, {});
    await page.goto("/");
    await page.getByTestId("language-toggle").click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("an error code in the Help hash scrolls its Vietnamese panel into view", async ({ page }) => {
    await setup(page, {});
    await page.goto("/help#unknown-flash-size");
    await expect(page.locator("#unknown-flash-size")).toBeInViewport();
    await expect(page.locator("#unknown-flash-size")).toContainText("Không đọc được dung lượng flash");
  });
});
