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

async function expectNoHorizontalScroll(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await setup(page, {});
  for (const path of ["/", "/install", "/first-use", "/passkeys", "/help", "/releases", "/nope"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(scrollWidth, path).toBeLessThanOrEqual(innerWidth!);
  }
}

for (const width of [375, 768]) {
  test(`${width}px wide: no page has horizontal scroll`, ({ page }) => expectNoHorizontalScroll(page, width));
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

test("the releases page lists every build with its flash size and verification level", async ({ page }) => {
  await setup(page, {});
  await page.goto("/releases");
  await expect(page.getByText("MultiKeys v0.2.0").first()).toBeVisible();
  for (const size of ["4 MB", "8 MB", "16 MB"]) await expect(page.getByText(size, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Build verified — not hardware tested").first()).toBeVisible();
  await expect(page.getByText("Hardware verified (ESP32-S3 N16R8)").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /download/i }).first()).toHaveAttribute("href", /\/api\/firmware\/v0\.2\.0\/multikey-firmware-v0\.2\.0-esp32s3-(4|8|16)mb-fido-dev\.zip/);
});

test("the releases page shows a legacy v0.2.0 release as a single 16 MB build", async ({ page }) => {
  await setup(page, { release: "legacy-v1" });
  await page.goto("/releases");
  await expect(page.getByText("MultiKeys v0.2.0").first()).toBeVisible();
  await expect(page.getByText("16 MB", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("4 MB", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Build verified — not hardware tested")).toHaveCount(1);
});

test.describe("First use", () => {
  test("checks the key without changing anything", async ({ page }) => {
    await setup(page, {});
    await page.goto("/first-use");
    await page.getByRole("button", { name: "Check my key" }).click();
    await expect(page.getByText("Found: MultiKeys Security Key")).toBeVisible();
    expect(await keyWrites(page)).toEqual([]);
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

  for (const width of [375, 768]) {
    test(`${width}px wide: no page has horizontal scroll`, ({ page }) => expectNoHorizontalScroll(page, width));
  }
});
