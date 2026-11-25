import { expect, type Page, test } from "@playwright/test";
import { type ExtraRelease, setup } from "./helpers";

const OLDER: ExtraRelease = { version: "0.1.5", publishedAt: "2026-10-01T00:00:00Z" };
const PRE: ExtraRelease = { version: "0.3.0-rc.1", prerelease: true, publishedAt: "2026-11-25T00:00:00Z" };
const BOTH = { images: ["fido", "openpgp"] as ("fido" | "openpgp")[] };

const download = (page: Page) => page.getByRole("link", { name: "Download" });
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test.describe("Releases", () => {
  test("the hero shows the latest stable release and links to Install", async ({ page }) => {
    await setup(page, {}, { extraReleases: [PRE, OLDER] });
    await page.goto("/releases");
    await expect(page.getByRole("heading", { level: 1, name: "Releases" })).toBeVisible();
    const hero = page.getByRole("heading", { level: 2, name: "MultiKeys v0.2.0" });
    await expect(hero).toBeVisible();
    const panel = hero.locator("xpath=../../..");
    await expect(panel.getByText("Latest", { exact: true })).toBeVisible();
    await expect(panel.getByText("Stable", { exact: true })).toBeVisible();
    await expect(panel.getByRole("link", { name: /Release notes/ })).toHaveAttribute("href", "https://example.invalid/notes");
    await expect(panel.getByRole("link", { name: "Install firmware" })).toHaveAttribute("href", "/install");
  });

  test("a newer pre-release is labelled in the history and is not the hero", async ({ page }) => {
    await setup(page, {}, { extraReleases: [PRE, OLDER] });
    await page.goto("/releases");
    const row = page.locator("#release-v0\\.3\\.0-rc\\.1");
    await expect(row).toContainText("Pre-release");
    await expect(row).not.toContainText("Latest");
    await expect(page.getByRole("heading", { level: 2, name: "MultiKeys v0.3.0-rc.1" })).toHaveCount(0);
    await expect(download(page)).toHaveAttribute("href", /\/api\/firmware\/v0\.2\.0\//);
  });

  test("the default artifact is FIDO2 at 16 MB with the exact asset URL, and the verification comes from the manifest", async ({ page }) => {
    const fw = await setup(page, BOTH);
    await page.goto("/releases");
    await expect(tab(page, "FIDO2")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "16 MB")).toHaveAttribute("aria-selected", "true");
    const b = fw.builds.find((x) => x.image === "fido" && x.flash_size === "16MB")!;
    await expect(page.getByText(b.package.name, { exact: true })).toBeVisible();
    await expect(download(page)).toHaveAttribute("href", `/api/firmware/v0.2.0/${b.package.name}`);
    await expect(download(page)).toHaveAttribute("download", b.package.name);
    await expect(page.getByText("Hardware verified (ESP32-S3 N16R8)")).toBeVisible();
  });

  test("the flash size and firmware type change the artifact", async ({ page }) => {
    await setup(page, BOTH);
    await page.goto("/releases");
    await tab(page, "4 MB").click();
    await expect(download(page)).toHaveAttribute("href", /-4mb-fido-/);
    await expect(page.getByText("Build verified — not hardware tested")).toBeVisible();
    await expect(page.getByText("Hardware verified", { exact: false })).toHaveCount(0);
    await tab(page, "OpenPGP").click();
    await expect(download(page)).toHaveAttribute("href", /-4mb-openpgp-/);
    await expect(page.locator("[data-slot=alert-description]", { hasText: "not suitable for protecting important accounts" })).toBeVisible();
    await tab(page, "FIDO2").click();
    await expect(download(page)).toHaveAttribute("href", /-4mb-fido-/);
  });

  test("the flash-size tabs follow the keyboard", async ({ page }) => {
    await setup(page, {});
    await page.goto("/releases");
    await tab(page, "16 MB").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "8 MB")).toHaveAttribute("aria-selected", "true");
    await expect(download(page)).toHaveAttribute("href", /-8mb-fido-/);
  });

  test("a combination the release lacks says so, and offers a release that has it", async ({ page }) => {
    await setup(page, { ...BOTH, release: "legacy-v1" }, { extraReleases: [PRE] });
    await page.goto("/releases");
    await tab(page, "OpenPGP").click();
    const status = page.getByRole("status").filter({ hasText: "has no OpenPGP build" });
    await expect(status).toContainText("v0.2.0 has no OpenPGP build for 16 MB of flash.");
    await expect(download(page)).toHaveCount(0);
    await status.getByRole("button", { name: "Show v0.3.0-rc.1" }).click();
    await expect(download(page)).toHaveAttribute("href", /\/api\/firmware\/v0\.3\.0-rc\.1\/.*-16mb-openpgp-/);
  });

  test("an older release opens from the history and from the version menu", async ({ page }) => {
    await setup(page, {}, { extraReleases: [OLDER] });
    await page.goto("/releases");
    await page.getByRole("button", { name: "Show the firmware of v0.1.5" }).click();
    await expect(page.getByRole("combobox", { name: "Version" })).toContainText("v0.1.5");
    await expect(download(page)).toHaveAttribute("href", /\/api\/firmware\/v0\.1\.5\//);
    await page.getByRole("combobox", { name: "Version" }).click();
    await page.getByRole("option", { name: /v0\.2\.0/ }).click();
    await expect(download(page)).toHaveAttribute("href", /\/api\/firmware\/v0\.2\.0\//);
  });

  test("a legacy v0.2.0 release offers a single 16 MB build and says its manifest is schema 1", async ({ page }) => {
    await setup(page, { release: "legacy-v1" });
    await page.goto("/releases");
    await expect(tab(page, "16 MB")).toBeVisible();
    await expect(tab(page, "4 MB")).toHaveCount(0);
    await expect(page.getByText("Build verified — not hardware tested")).toHaveCount(1);
    await page.getByRole("button", { name: "Technical details" }).click();
    await expect(page.getByText("Schema 1 (legacy)")).toBeVisible();
  });

  test("technical details show the full SHA-256 and Copy puts it on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const fw = await setup(page, {});
    await page.goto("/releases");
    const b = fw.builds.find((x) => x.image === "fido" && x.flash_size === "16MB")!;
    await page.getByRole("button", { name: "Technical details" }).click();
    await expect(page.getByText(b.package.sha256, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Copy SHA-256" }).click();
    await expect(page.getByRole("button", { name: "Copy SHA-256" })).toContainText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(b.package.sha256);
  });

  test("a failed release list shows the error, and Retry loads it", async ({ page }) => {
    await setup(page, {});
    let calls = 0;
    await page.route("**/api/releases", (r) => (calls++ === 0 ? r.fulfill({ status: 500, body: "boom" }) : r.fallback()));
    await page.goto("/releases");
    await expect(page.getByRole("alert")).toContainText("The release list couldn't be loaded");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "MultiKeys v0.2.0" })).toBeVisible();
  });

  test("an empty release list says there is no firmware release", async ({ page }) => {
    await setup(page, {});
    await page.route("**/api/releases", (r) => r.fulfill({ json: [] }));
    await page.goto("/releases");
    await expect(page.getByText("No firmware release yet")).toBeVisible();
    await expect(download(page)).toHaveCount(0);
  });

  test("the history says which releases it leaves out", async ({ page }) => {
    await setup(page, {});
    await page.goto("/releases");
    await expect(page.getByText(/host tools only/i).or(page.getByText(/only hold host tools/))).toBeVisible();
  });

  test("on a phone nothing overflows and the controls stay reachable", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await setup(page, BOTH, { extraReleases: [OLDER] });
    await page.goto("/releases");
    await expect(download(page)).toBeVisible();
    await expect(tab(page, "OpenPGP")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test.describe("in Vietnamese", () => {
    test.use({ locale: "vi-VN" });
    test("the page is translated", async ({ page }) => {
      await setup(page, {}, { extraReleases: [OLDER] });
      await page.goto("/releases");
      await expect(page.getByRole("heading", { level: 1, name: "Bản phát hành" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Cài đặt firmware" })).toHaveAttribute("href", "/install");
      await expect(page.getByRole("link", { name: "Tải xuống" }).or(page.getByRole("link", { name: /Tải/ })).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Xem firmware của v0.1.5" })).toBeVisible();
    });
  });
});
