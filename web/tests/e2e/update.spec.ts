import { expect, type Page, test } from "@playwright/test";
import { type FirmwareFixture, makeFirmware } from "../fixtures/firmware";
import { flashWrites } from "./helpers";
import type { Scenario } from "./scenario";

const APP = 0x20000;
const TAG = "v0.3.3";
const OLD_SHA = "11".repeat(32);
const pending = (page: Page) => page.evaluate(() => localStorage.getItem("multikeys-pending-update"));

/** A fake server that publishes one release, v0.3.3, with or without `update.app_only`. */
async function setupUpdate(
  page: Page,
  scenarioOf: (fw: FirmwareFixture) => Scenario,
  opts: { appOnly?: boolean; pendingRecord?: boolean } = {},
): Promise<FirmwareFixture> {
  const fw = await makeFirmware({ appOnly: opts.appOnly ?? true, version: "0.3.3", tag: TAG });
  const record = { project: "multikey-fido", fromVersion: "0.3.1", toVersion: "0.3.3", tag: TAG, profileId: "esp32s3-16mb", appSha256: "0".repeat(64), startedAt: "2026-11-24T00:00:00Z" };
  await page.addInitScript(
    ([s, rec]) => {
      localStorage.setItem("multikeys-e2e-scenario", JSON.stringify(s));
      if (rec && !sessionStorage.getItem("seeded")) {
        localStorage.setItem("multikeys-pending-update", JSON.stringify(rec));
        sessionStorage.setItem("seeded", "1");
      }
    },
    [scenarioOf(fw), opts.pendingRecord ? record : null] as const,
  );
  await page.route("**/api/releases", (r) =>
    r.fulfill({ json: [{ tag: TAG, name: `MultiKeys ${TAG}`, prerelease: false, published_at: "2026-11-24T00:00:00Z", html_url: "https://example.invalid/notes" }] }),
  );
  await page.route(`**/api/firmware/${TAG}/firmware-manifest.json`, (r) => r.fulfill({ json: fw.manifest }));
  for (const [name, bytes] of fw.zips) {
    const zip = Buffer.from(bytes);
    await page.route(`**/api/firmware/${TAG}/${name}`, (r) => r.fulfill({ body: zip, headers: { "Content-Type": "application/zip" } }));
  }
  return fw;
}

const KEY_BEFORE: Scenario["key"] = { name: "My Key", build: { version: "0.3.1", imageSha256: OLD_SHA } };
const running = (extra: Partial<Scenario> = {}) => (): Scenario => ({ device: "fido-0.3.1", key: KEY_BEFORE, ...extra });

const next = (page: Page) => page.getByRole("button", { name: "Continue" });

/** Connect key -> Check for updates -> the download-mode chooser -> Review. */
async function toReview(page: Page) {
  await page.goto("/update");
  await page.getByRole("button", { name: "Choose key" }).click();
  await expect(page.getByText("The key reports")).toBeVisible();
  await next(page).click();
  await expect(page.getByText("Offered")).toBeVisible();
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await expect(page.getByTestId("update-outcome")).toBeVisible();
}

async function ackAll(page: Page) {
  for (const box of await page.getByRole("checkbox").all()) await box.check();
}

test("the home page offers the update next to the installer", async ({ page }) => {
  await setupUpdate(page, running());
  await page.goto("/");
  await page.getByRole("link", { name: "Update firmware" }).click();
  await expect(page).toHaveURL(/\/update$/);
  await expect(page.getByRole("heading", { level: 1, name: "Update firmware" })).toBeVisible();
});

test("an older key is updated with one write of the app region and verified afterwards", async ({ page }) => {
  await setupUpdate(page, running());
  await toReview(page);
  await expect(page.getByTestId("update-outcome")).toHaveAttribute("data-outcome", "safe-update");
  await expect(page.getByTestId("update-type")).toHaveText("Application-only update");
  await expect(page.getByText("0.3.1").first()).toBeVisible();
  await expect(page.getByText(/version 0\.3\.3 \(v0\.3\.3\)/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "MultiKeys app", exact: true })).toHaveCount(1);
  await expect(page.getByText("Bootloader", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Partition table", { exact: true })).toHaveCount(0);
  const update = page.getByRole("button", { name: "Update application" });
  await expect(update).toBeDisabled();
  await ackAll(page);
  await update.click();
  await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible();
  expect(await flashWrites(page)).toEqual([APP]);
  expect(await pending(page)).toBeNull();

  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByTestId("update-verdict")).toHaveAttribute("data-verdict", "verified");
  await expect(page.getByTestId("verify-image")).toContainText("Verified");
  await expect(page.getByTestId("verify-name")).toContainText("Verified");
  await expect(page.getByTestId("verify-mkauth")).toContainText("Verified");
  await expect(page.getByTestId("verify-fido")).toContainText("Not checked");
});

test("a key that already runs the newest image is told so, without a download-mode step", async ({ page }) => {
  await setupUpdate(page, (fw) => ({
    device: "fido-0.3.1",
    key: { name: "My Key", build: { version: "0.3.3", imageSha256: fw.build.images.find((i) => i.role === "app")!.sha256 } },
  }));
  await page.goto("/update");
  await page.getByRole("button", { name: "Choose key" }).click();
  await next(page).click();
  await expect(page.getByText("Already up to date")).toBeVisible();
  await expect(next(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose device" })).toHaveCount(0);
  expect(await flashWrites(page)).toEqual([]);
});

test("the check step lists only releases newer than the key, selects the one right after it, and a pick is what gets offered", async ({ page }) => {
  await setupUpdate(page, running());
  const older = await makeFirmware({ appOnly: true, version: "0.3.2", tag: "v0.3.2" });
  const same = await makeFirmware({ appOnly: true, version: "0.3.1", tag: "v0.3.1" });
  const summary = (tag: string, at: string) => ({ tag, name: `MultiKeys ${tag}`, prerelease: false, published_at: at, html_url: "https://example.invalid/notes" });
  await page.route("**/api/releases", (r) =>
    r.fulfill({ json: [summary(TAG, "2026-11-24T00:00:00Z"), summary("v0.3.2", "2026-11-23T00:00:00Z"), summary("v0.3.1", "2026-11-22T00:00:00Z")] }),
  );
  await page.route("**/api/firmware/v0.3.2/firmware-manifest.json", (r) => r.fulfill({ json: older.manifest }));
  await page.route("**/api/firmware/v0.3.1/firmware-manifest.json", (r) => r.fulfill({ json: same.manifest }));
  await page.goto("/update");
  await page.getByRole("button", { name: "Choose key" }).click();
  await next(page).click();
  await expect(page.getByText(/version 0\.3\.2 \(v0\.3\.2\)/)).toBeVisible();
  await page.getByRole("combobox", { name: "Choose another version" }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option", { name: /v0\.3\.1/ })).toHaveCount(0);
  await page.getByRole("option", { name: /v0\.3\.3/ }).click();
  await expect(page.getByText(/version 0\.3\.3 \(v0\.3\.3\)/)).toBeVisible();
});

test("a release without update.app_only is never offered: the installer is the way forward", async ({ page }) => {
  await setupUpdate(page, running(), { appOnly: false });
  await page.goto("/update");
  await page.getByRole("button", { name: "Choose key" }).click();
  await next(page).click();
  await expect(page.getByText("This release has no application-only update")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the installer" })).toBeVisible();
  await expect(next(page)).toHaveCount(0);
  expect(await flashWrites(page)).toEqual([]);
});

test("a key that is not the one that was read is refused before anything is written", async ({ page }) => {
  await setupUpdate(page, () => ({ device: "fido-0.3.1", key: { name: "My Key", build: { version: "0.3.2", imageSha256: OLD_SHA } } }));
  await toReview(page);
  await expect(page.getByTestId("update-outcome")).toHaveAttribute("data-reason", "different-key");
  await expect(page.getByRole("button", { name: "Update application" })).toHaveCount(0);
  expect(await flashWrites(page)).toEqual([]);
});

test("an OpenPGP key is never offered a FIDO2 image: the update stops before anything is written", async ({ page }) => {
  await setupUpdate(page, () => ({ device: "openpgp-0.3.1" }));
  await page.goto("/update");
  await page.getByRole("button", { name: "Continue without reading the key" }).click();
  await next(page).click();
  // The release carries only a FIDO2 image, so there is nothing the OpenPGP key could be updated to.
  await expect(page.getByText("Offered")).toBeVisible();
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "profile-not-in-release");
  expect(await flashWrites(page)).toEqual([]);
});

test("a write that is interrupted keeps the record, shows the recovery, and writes nothing else", async ({ page }) => {
  await setupUpdate(page, running({ disconnectAt: 0.4 }));
  await toReview(page);
  await ackAll(page);
  await page.getByRole("button", { name: "Update application" }).click();
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "disconnected-during-flash");
  await expect(page.getByTestId("update-recovery")).toBeVisible();
  expect(await pending(page)).not.toBeNull();
  expect(await flashWrites(page)).toEqual([]);
});

test("after an interrupted write the unreadable application is repaired, with REPAIR typed", async ({ page }) => {
  await setupUpdate(page, () => ({ device: "fido-garbled" }), { pendingRecord: true });
  await page.goto("/update");
  await page.getByRole("button", { name: "Continue without reading the key" }).click();
  await next(page).click();
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await expect(page.getByTestId("update-outcome")).toHaveAttribute("data-outcome", "repair");
  const update = page.getByRole("button", { name: "Update application" });
  await page.getByRole("checkbox").check();
  await expect(update).toBeDisabled();
  await page.getByLabel(/Type REPAIR/).fill("REPAIR");
  await expect(update).toBeEnabled();
  await update.click();
  await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible();
  expect(await flashWrites(page)).toEqual([APP]);
  expect(await pending(page)).toBeNull();
});

test("an unreadable application with no record is not touched", async ({ page }) => {
  await setupUpdate(page, () => ({ device: "fido-garbled" }));
  await page.goto("/update");
  await page.getByRole("button", { name: "Continue without reading the key" }).click();
  await next(page).click();
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await expect(page.getByTestId("update-outcome")).toHaveAttribute("data-reason", "unreadable-descriptor");
  await expect(page.getByRole("button", { name: "Update application" })).toHaveCount(0);
  expect(await flashWrites(page)).toEqual([]);
});

test.describe("Vietnamese", () => {
  test.use({ locale: "vi-VN" });

  test("the update review is in Vietnamese", async ({ page }) => {
    await setupUpdate(page, running());
    await page.goto("/update");
    await expect(page.getByRole("heading", { level: 1, name: "Cập nhật firmware" })).toBeVisible();
    await page.getByRole("button", { name: "Chọn khóa" }).click();
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.getByRole("button", { name: "Chọn thiết bị" }).click();
    await expect(page.getByTestId("update-outcome")).toHaveAttribute("data-outcome", "safe-update");
    await expect(page.getByText("Cập nhật tương thích")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cập nhật ứng dụng" })).toBeDisabled();
  });
});
