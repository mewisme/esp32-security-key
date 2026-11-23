import { expect, test } from "@playwright/test";
import { setup } from "./helpers";

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

test("390px wide: home and wizard have no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, {});
  for (const path of ["/", "/install"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await page.getByRole("button", { name: "Start installation" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("home shows the experimental notice", async ({ page }) => {
  await setup(page, {});
  await page.goto("/");
  await expect(page.getByText("Experimental development firmware — not suitable for protecting important accounts.").first()).toBeVisible();
});
