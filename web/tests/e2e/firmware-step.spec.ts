import { expect, type Page, test } from "@playwright/test";
import { HARDWARE_CHECK, setup, type ExtraRelease } from "./helpers";

const next = (page: Page) => page.getByRole("button", { name: "Continue" });
const OLDER: ExtraRelease = { version: "0.1.5", publishedAt: "2026-10-01T00:00:00Z" };
const PRE: ExtraRelease = { version: "0.3.0-rc.1", prerelease: true, publishedAt: "2026-11-25T00:00:00Z" };

async function toStep2(page: Page) {
  await page.goto("/install");
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
}

async function chooseVersion(page: Page, version: string) {
  await page.getByRole("combobox", { name: "Choose another version" }).click();
  await page.getByRole("option", { name: new RegExp(`v${version.replace(/\./g, "\\.")}`) }).click();
}

const summary = (page: Page) => page.getByRole("group", { name: "Firmware", exact: true });

test.describe("Firmware step: release", () => {
  test("shows the newest stable release with its metadata", async ({ page }) => {
    await setup(page, {});
    await toStep2(page);
    const s = summary(page);
    await expect(s).toContainText("v0.2.0");
    await expect(s.getByText("Latest", { exact: true })).toBeVisible();
    await expect(s.getByText("Stable", { exact: true })).toBeVisible();
    await expect(s).toContainText("4 / 8 / 16 MB");
    await expect(s).toContainText("Released");
    await expect(s.getByRole("link", { name: /Release notes/ })).toHaveAttribute("href", "https://example.invalid/notes");
    // One release: nothing else to choose from.
    await expect(page.getByRole("combobox", { name: "Choose another version" })).toHaveCount(0);
  });

  test("an older release is selectable, stays shown, and survives Back, Continue and a reload", async ({ page }) => {
    await setup(page, {}, { extraReleases: [OLDER] });
    await toStep2(page);
    await chooseVersion(page, "0.1.5");
    const s = summary(page);
    await expect(s).toContainText("v0.1.5");
    await expect(s.getByText("Latest", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Choose another version" })).toContainText("v0.1.5");

    await next(page).click();
    await expect(page.getByRole("button", { name: "Choose device" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(summary(page)).toContainText("v0.1.5");

    await page.reload();
    await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
    await next(page).click();
    await expect(summary(page)).toContainText("v0.1.5");
  });

  test("a newer pre-release is not assumed to be the latest stable release", async ({ page }) => {
    await setup(page, {}, { extraReleases: [PRE, OLDER] });
    await toStep2(page);
    const s = summary(page);
    await expect(s).toContainText("v0.2.0");
    await expect(s.getByText("Latest", { exact: true }).first()).toBeVisible();
    await page.getByRole("combobox", { name: "Choose another version" }).click();
    const pre = page.getByRole("option", { name: /v0\.3\.0-rc\.1/ });
    await expect(pre).toContainText("Pre-release");
    await expect(pre).not.toContainText("Latest");
    await pre.click();
    await expect(s).toContainText("v0.3.0-rc.1");
    await expect(s.getByText("Pre-release", { exact: true }).first()).toBeVisible();
    await expect(s.getByText("Latest", { exact: true })).toHaveCount(0);
  });

  test("shows a loading placeholder, then an error with a retry", async ({ page }) => {
    await setup(page, {});
    let calls = 0;
    await page.route("**/api/releases", async (r) => {
      calls++;
      await page.waitForTimeout(600);
      await r.fulfill({ status: 500, body: "nope" });
    });
    await toStep2(page);
    await expect(page.getByRole("status", { name: "Loading releases" })).toBeVisible();
    await expect(page.getByText("The firmware list couldn't be loaded")).toBeVisible();
    await expect(next(page)).toBeDisabled();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("status", { name: "Loading releases" })).toBeVisible();
    await expect(page.getByText("The firmware list couldn't be loaded")).toBeVisible();
    expect(calls).toBe(2);
  });

  test("says so when no release is published", async ({ page }) => {
    await setup(page, {});
    await page.route("**/api/releases", (r) => r.fulfill({ json: [] }));
    await toStep2(page);
    await expect(page.getByText("No firmware release yet")).toBeVisible();
    await expect(next(page)).toBeDisabled();
  });

  test("offers OpenPGP as a real choice only when the release has the image", async ({ page }) => {
    await setup(page, { images: ["fido", "openpgp"] });
    await toStep2(page);
    await expect(page.getByTestId("openpgp-unavailable")).toHaveCount(0);
    await expect(page.locator("#image-openpgp")).toBeEnabled();
    await page.locator("#image-openpgp").check();
    await expect(page.getByText("Read this before choosing OpenPGP")).toBeVisible();
    await expect(page.getByTestId("usb-preview")).toHaveCount(0);
  });
});

test.describe("Firmware step: personalization", () => {
  test("keeps the current name by default without claiming to know it", async ({ page }) => {
    await setup(page, {});
    await toStep2(page);
    await expect(page.getByRole("radio", { name: "Keep current" })).toBeChecked();
    await expect(page.getByText("The name already on the key is preserved.")).toBeVisible();
    const preview = page.getByTestId("usb-preview");
    await expect(preview).toContainText("Current name kept");
    await expect(preview).toContainText("USB 303A:4002");
    await expect(preview).toContainText("Not applied yet");
    await expect(next(page)).toBeEnabled();
  });

  test("the default option shows the firmware's name and hides the input", async ({ page }) => {
    await setup(page, {});
    await toStep2(page);
    await page.getByRole("radio", { name: "Default" }).check();
    await expect(page.getByLabel("Device name")).toHaveCount(0);
    await expect(page.getByText("The USB product name is set to the firmware default, “MultiKeys Security Key”.")).toBeVisible();
    await expect(page.getByTestId("usb-preview")).toContainText("MultiKeys Security Key");
  });

  test("a custom name has a counter, a live preview and validation, and keeps its text across modes", async ({ page }) => {
    await setup(page, {});
    await toStep2(page);
    await page.getByRole("radio", { name: "Custom name" }).check();
    const field = page.getByLabel("Device name");
    await expect(page.getByRole("button", { name: "Restore default" })).toHaveCount(0);
    await field.fill("Desk key");
    await expect(page.getByText("8/31")).toBeVisible();
    await expect(page.getByTestId("usb-preview")).toContainText("Desk key");
    await expect(next(page)).toBeEnabled();

    await page.getByRole("radio", { name: "Keep current" }).check();
    await expect(page.getByTestId("usb-preview")).toContainText("Current name kept");
    await page.getByRole("radio", { name: "Custom name" }).check();
    await expect(page.getByLabel("Device name")).toHaveValue("Desk key");

    await field.fill("Mêw");
    await expect(page.getByText("Use plain ASCII letters, digits, spaces and punctuation only (no accents or emoji).")).toBeVisible();
    await expect(next(page)).toBeDisabled();
    await field.fill("");
    await expect(next(page)).toBeDisabled();
    await field.fill("x".repeat(32));
    await expect(next(page)).toBeDisabled();
    await field.fill(" Mew");
    await expect(next(page)).toBeDisabled();
    await field.fill("Mew");
    await expect(next(page)).toBeEnabled();
  });

  test("the chosen mode and name survive a reload", async ({ page }) => {
    await setup(page, {}, { extraReleases: [OLDER] });
    await toStep2(page);
    await page.getByRole("radio", { name: "Custom name" }).check();
    await page.getByLabel("Device name").fill("Desk key");
    await page.reload();
    await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
    await next(page).click();
    await expect(page.getByRole("radio", { name: "Custom name" })).toBeChecked();
    await expect(page.getByLabel("Device name")).toHaveValue("Desk key");
    await expect(summary(page)).toContainText("v0.2.0");
  });
});

for (const width of [375, 768, 1280, 1440]) {
  test(`${width}px wide: step 2 has no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, { images: ["fido", "openpgp"] }, { extraReleases: [OLDER, PRE] });
    await toStep2(page);
    await page.getByRole("radio", { name: "Custom name" }).check();
    await page.getByLabel("Device name").fill("x".repeat(31));
    await expect(summary(page)).toContainText("v0.2.0");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
