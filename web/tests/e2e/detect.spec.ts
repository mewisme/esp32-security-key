// The one /install flow detects what is on the board and plans from that: update, reinstall, repair, downgrade, the
// full-install fallback, and the refusals. Everything runs against the simulated board (fake-create-driver.ts).
import { expect, type Page, test } from "@playwright/test";
import { flashWrites } from "./helpers";
import { ackAll, APP, KEY_BEFORE, next, OLD_SHA, pending, setupFlash, toFirmware, toReview } from "./flash-helpers";

const mode = (page: Page) => page.getByTestId("install-mode");
const install = (page: Page) => page.getByRole("button", { name: "Install firmware" });
const LATEST = [{ version: "0.3.3" }];

test("an older key is updated with one write of the app region and verified afterwards", async ({ page }) => {
  await setupFlash(page, { device: "fido-0.3.1", key: KEY_BEFORE }, LATEST);
  await toFirmware(page);
  // Optional: read the running key first so the page can refuse a different key and compare before and after.
  await page.getByRole("button", { name: "Read my key" }).click();
  await expect(page.getByText("The key reports")).toBeVisible();
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await expect(mode(page)).toHaveText("Update the application only");
  await expect(page.getByRole("cell", { name: "MultiKeys app", exact: true })).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "Bootloader", exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Partition table", exact: true })).toHaveCount(0);
  await expect(install(page)).toBeDisabled();
  await ackAll(page);
  await install(page).click();
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

test("a key that already runs this exact build can have it reinstalled: one app write, bootloader and storage untouched", async ({ page }) => {
  await setupFlash(page, { device: "fido-0.3.3-current" }, LATEST);
  await toReview(page);
  await expect(mode(page)).toHaveText("Reinstall the application");
  await expect(page.getByTestId("reinstall-note")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Bootloader", exact: true })).toHaveCount(0);
  await expect(install(page)).toBeDisabled();
  await ackAll(page);
  await install(page).click();
  await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible();
  expect(await flashWrites(page)).toEqual([APP]);
});

test("the same version with different content is a repair that needs REPAIR typed", async ({ page }) => {
  await setupFlash(page, { device: "fido-0.3.3" }, LATEST);
  await toReview(page);
  await expect(mode(page)).toHaveText("Repair the application");
  await ackAll(page);
  await expect(install(page)).toBeDisabled();
  await page.getByLabel(/Type REPAIR/).fill("REPAIR");
  await expect(install(page)).toBeEnabled();
  await install(page).click();
  await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible();
  expect(await flashWrites(page)).toEqual([APP]);
});

test("a downgrade is an app-only write when the installed release declares its data readable by the older one", async ({ page }) => {
  await setupFlash(page, { device: "fido-0.3.3" }, [{ version: "0.3.3", downgradeFloor: "0.2.0" }, { version: "0.3.1" }]);
  await toReview(page, "0.3.1");
  await expect(mode(page)).toHaveText("Downgrade the application");
  await expect(page.getByTestId("downgrade-warning")).toBeVisible();
  await expect(page.getByTestId("app-only-refusal")).toHaveCount(0);
  await expect(install(page)).toBeDisabled();
  await ackAll(page);
  await install(page).click();
  await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible();
  expect(await flashWrites(page)).toEqual([APP]);
});

test("a downgrade the installed release does not declare is only offered as the forced full install, with the reason", async ({ page }) => {
  await setupFlash(page, { device: "fido-0.3.3" }, [{ version: "0.3.3" }, { version: "0.3.1" }]);
  await toReview(page, "0.3.1");
  await expect(mode(page)).toHaveText("Forced update (outside the declared range)");
  await expect(page.getByTestId("app-only-refusal")).toBeVisible();
  await expect(install(page)).toBeDisabled();
  await ackAll(page);
  await page.getByLabel(/Type FORCE/).fill("FORCE");
  await install(page).click();
  await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible();
  expect(await flashWrites(page)).toEqual([0, 0x8000, APP]);
});

test("when the release has no app-only update the full install is offered, with the reason, never applied silently", async ({ page }) => {
  await setupFlash(page, { device: "fido-0.3.1" }, [{ version: "0.3.3", appOnly: false }]);
  await toReview(page);
  await expect(mode(page)).toHaveText("Update");
  await expect(page.getByTestId("app-only-refusal")).toBeVisible();
  await expect(install(page)).toBeDisabled();
  await ackAll(page);
  await install(page).click();
  await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible();
  expect(await flashWrites(page)).toEqual([0, 0x8000, APP]);
});

test("a board that is not the key that was read is refused before anything is written", async ({ page }) => {
  await setupFlash(page, { device: "fido-0.3.1", key: { name: "My Key", build: { version: "0.3.2", imageSha256: OLD_SHA } } }, LATEST);
  await toFirmware(page);
  await page.getByRole("button", { name: "Read my key" }).click();
  await expect(page.getByText("The key reports")).toBeVisible();
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "different-key");
  expect(await flashWrites(page)).toEqual([]);
});

test("an OpenPGP key is never offered a FIDO2 image: the flow stops before anything is written", async ({ page }) => {
  await setupFlash(page, { device: "openpgp-0.3.1" }, LATEST);
  await toReview(page);
  // The release carries only a FIDO2 image, so there is nothing the OpenPGP key could be updated to.
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "profile-not-in-release");
  expect(await flashWrites(page)).toEqual([]);
});

test("a write that is interrupted keeps the record and writes nothing else", async ({ page }) => {
  await setupFlash(page, { device: "fido-0.3.1", disconnectAt: 0.4 }, LATEST);
  await toReview(page);
  await ackAll(page);
  await install(page).click();
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "disconnected-during-flash");
  expect(await pending(page)).not.toBeNull();
  expect(await flashWrites(page)).toEqual([]);
});

test("after an interrupted write the unreadable application is repaired, with REPAIR typed", async ({ page }) => {
  await setupFlash(page, { device: "fido-garbled" }, LATEST, { pendingRecord: true });
  await toReview(page);
  await expect(mode(page)).toHaveText("Repair the application");
  await ackAll(page);
  await expect(install(page)).toBeDisabled();
  await page.getByLabel(/Type REPAIR/).fill("REPAIR");
  await install(page).click();
  await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible();
  expect(await flashWrites(page)).toEqual([APP]);
  expect(await pending(page)).toBeNull();
});

test("a record that names another chip is not used to repair; the full install is offered and the record can be discarded", async ({ page }) => {
  await setupFlash(page, { device: "fido-garbled" }, LATEST, { pendingRecord: true, pendingOverride: { chipMac: "80:b5:4e:c8:22:79" } });
  await toReview(page);
  await expect(mode(page)).toHaveText("Replace the firmware on this board");
  await expect(page.getByTestId("app-only-refusal")).toBeVisible();
  expect(await flashWrites(page)).toEqual([]);
  expect(await pending(page)).not.toBeNull();
  await page.getByRole("button", { name: "Discard the record and start over" }).click();
  expect(await pending(page)).toBeNull();
  await expect(page.getByTestId("usb-preview")).toBeVisible();
});

test("an unreadable application with no record is not repaired in place", async ({ page }) => {
  await setupFlash(page, { device: "fido-garbled" }, LATEST);
  await toReview(page);
  await expect(mode(page)).toHaveText("Replace the firmware on this board");
  await expect(page.getByTestId("app-only-refusal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Discard the record and start over" })).toHaveCount(0);
});

test("the review can go back to choose another version without writing anything", async ({ page }) => {
  await setupFlash(page, { device: "fido-0.3.1" }, [{ version: "0.3.3" }, { version: "0.3.2" }]);
  await toReview(page);
  await page.getByRole("button", { name: "Choose another version" }).click();
  await expect(page.getByRole("combobox", { name: "Choose another version" })).toBeVisible();
  expect(await flashWrites(page)).toEqual([]);
});

test.describe("Vietnamese", () => {
  test.use({ locale: "vi-VN" });

  test("the detected plan is in Vietnamese", async ({ page }) => {
    await setupFlash(page, { device: "fido-0.3.1" }, LATEST);
    await page.goto("/install");
    await page.getByRole("checkbox", { name: "Bo mạch của tôi là ESP32-S3 có cổng USB gốc (native) và nút BOOT" }).check();
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.getByRole("button", { name: "Chọn thiết bị" }).click();
    await expect(mode(page)).toHaveText("Chỉ cập nhật ứng dụng");
    await expect(page.getByRole("button", { name: "Cài đặt firmware" })).toBeDisabled();
  });
});
