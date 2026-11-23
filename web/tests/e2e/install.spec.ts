import { expect, type Page, test } from "@playwright/test";
import { ackAll, HARDWARE_CHECK, keyWrites, recordDownloads, setup, toChooser } from "./helpers";

const NAME = "Mew's Security Key";
const CLI = `multikey device rename "${NAME}" --reenumerate`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" });

/** Stage 1 + 2 with an optional custom name, then device chooser, acks, install: ends on the Finish stage. */
async function installWithName(page: Page, name: string | null) {
  await page.goto("/install");
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
  if (name !== null) {
    await page.getByRole("radio", { name: "Custom name" }).check();
    await page.getByLabel("Device name").fill(name);
  }
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await ackAll(page);
  await page.getByRole("button", { name: "Install firmware" }).click();
  await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible();
}

test("A: first install on a blank board, key detected", async ({ page }) => {
  await setup(page, { device: "blank" });
  await toChooser(page);
  await expect(page.getByTestId("install-mode")).toHaveText("First installation");
  const install = page.getByRole("button", { name: "Install firmware" });
  await expect(install).toBeDisabled();
  await ackAll(page);
  await install.click();
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("Key detected: MultiKeys Security Key")).toBeVisible();
  const m = page.getByTestId("milestones");
  for (const t of ["Downloaded: yes", "Checksums verified: yes", "Written: yes", "Flash contents verified: yes", "Key detected: yes"]) {
    await expect(m).toContainText(t);
  }
});

test("B: board running 0.1.0-dev needs the update-unverified acknowledgement", async ({ page }) => {
  await setup(page, { device: "fido-0.1.0-dev" });
  await toChooser(page);
  await expect(page.getByTestId("install-mode")).toHaveText("Update (stored keys not guaranteed)");
  const install = page.getByRole("button", { name: "Install firmware" });
  await page.getByLabel(/experimental development firmware/).check();
  await expect(install).toBeDisabled();
  await page.getByLabel(/may not be usable after this update/).check();
  await expect(install).toBeEnabled();
  await expect(page.getByText("Never touched: nvs, phy_init, part0 (your keys)")).toBeVisible();
});

test("C: another chip stops before anything is written", async ({ page }) => {
  await setup(page, { chip: "ESP32" });
  await toChooser(page);
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "unsupported-chip");
});

test("D: no answer from the chip -> download-mode guidance and retry", async ({ page }) => {
  await setup(page, { connectError: true });
  await toChooser(page);
  const panel = page.getByTestId("error-panel");
  await expect(panel).toHaveAttribute("data-error-code", "not-download-mode");
  await expect(panel).toContainText("hold the BOOT button");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Choose device" })).toBeVisible();
});

test("E: browser without Web Serial", async ({ page }) => {
  await setup(page, {}, { noSerial: true });
  await page.goto("/install");
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "browser-unsupported");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("F: disconnect at 40% -> disconnected-during-flash, never completed", async ({ page }) => {
  await setup(page, { device: "blank", disconnectAt: 0.4 });
  await toChooser(page);
  await ackAll(page);
  await page.getByRole("button", { name: "Install firmware" }).click();
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "disconnected-during-flash");
  await expect(page.getByRole("button", { name: "Check my key" })).toHaveCount(0);
  await expect(page.getByText("Written and verified")).toHaveCount(0);
});

test("G: key check fails -> verified flash, running key not checked, no working claim", async ({ page }) => {
  await setup(page, { device: "blank", checker: "throw" });
  await toChooser(page);
  await ackAll(page);
  await page.getByRole("button", { name: "Install firmware" }).click();
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("Flash verified; running key not checked")).toBeVisible();
  await expect(page.getByText(/Key detected: MultiKeys/)).toHaveCount(0);
  await expect(page.getByText(/working/i)).toHaveCount(0);
});

test("H: a 4 MB board gets the 4 MB build, labelled build-verified, and needs the untested-hardware acknowledgement", async ({ page }) => {
  const downloads = recordDownloads(page);
  await setup(page, { device: "blank", flashSize: "4MB", features: ["Wi-Fi", "BLE"] });
  await toChooser(page);
  await expect(page.getByText("MultiKeys FIDO2 — 4 MB")).toBeVisible();
  await expect(page.getByText("Build verified — not hardware tested").first()).toBeVisible();
  await expect(page.getByText("Not tested on this board")).toBeVisible();
  const install = page.getByRole("button", { name: "Install firmware" });
  await page.getByLabel(/experimental development firmware/).check();
  await expect(install).toBeDisabled();
  await page.getByLabel(/hasn't been tested with MultiKeys/).check();
  await expect(install).toBeEnabled();
  await install.click();
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("Key detected: MultiKeys Security Key")).toBeVisible();
  expect(downloads).toEqual(["multikey-firmware-v0.2.0-esp32s3-4mb-fido-dev.zip"]);
});

test("I: the tested N16R8 is hardware-verified and needs no extra acknowledgement", async ({ page }) => {
  const downloads = recordDownloads(page);
  await setup(page, { device: "blank" });
  await toChooser(page);
  await expect(page.getByText("MultiKeys FIDO2 — 16 MB")).toBeVisible();
  await expect(page.getByText("Hardware verified (ESP32-S3 N16R8)").first()).toBeVisible();
  await expect(page.getByLabel(/hasn't been tested with MultiKeys/)).toHaveCount(0);
  await expect(page.getByText("Not tested on this board")).toHaveCount(0);
  expect(downloads).toEqual(["multikey-firmware-v0.2.0-esp32s3-16mb-fido-dev.zip"]);
});

test("I2: another 16 MB board is expected-compatible and needs the acknowledgement", async ({ page }) => {
  await setup(page, { device: "blank", features: ["Wi-Fi", "BLE"] });
  await toChooser(page);
  await expect(page.getByText("Expected compatible — not tested on this exact board").first()).toBeVisible();
  await expect(page.getByLabel(/hasn't been tested with MultiKeys/)).toBeVisible();
});

test("J: a 2 MB board is refused with the supported sizes", async ({ page }) => {
  await setup(page, { flashSize: "2MB" });
  await toChooser(page);
  const panel = page.getByTestId("error-panel");
  await expect(panel).toHaveAttribute("data-error-code", "wrong-flash-size");
  await expect(panel).toContainText("4, 8 or 16 MB");
});

test("K: an octal-flash board is refused", async ({ page }) => {
  await setup(page, { flashType: "octal", flashSize: "8MB" });
  await toChooser(page);
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "unsupported-flash-mode");
  await expect(page.getByTestId("error-panel")).toContainText("nothing was written");
});

test("L: an unreadable flash size is refused, with a retry", async ({ page }) => {
  await setup(page, { flashSize: null });
  await toChooser(page);
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "unknown-flash-size");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("M: a legacy v0.2.0 release has no build for an 8 MB board", async ({ page }) => {
  await setup(page, { release: "legacy-v1", flashSize: "8MB", features: ["Wi-Fi", "BLE"] });
  await toChooser(page);
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "profile-not-in-release");
});

test("M2: the legacy v0.2.0 release still installs on a 16 MB board", async ({ page }) => {
  const downloads = recordDownloads(page);
  await setup(page, { release: "legacy-v1", device: "blank" });
  await toChooser(page);
  await expect(page.getByTestId("install-mode")).toHaveText("First installation");
  await ackAll(page);
  await page.getByRole("button", { name: "Install firmware" }).click();
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("Key detected: MultiKeys Security Key")).toBeVisible();
  expect(downloads).toEqual(["multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev.zip"]);
});

test("N: a custom name survives Back and a reload, is applied after the flash and verified", async ({ page }) => {
  await setup(page, { device: "blank" });
  await page.goto("/install");
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
  await page.getByRole("radio", { name: "Custom name" }).check();
  await page.getByLabel("Device name").fill(NAME);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
  await expect(page.getByRole("radio", { name: "Custom name" })).toBeChecked();
  await expect(page.getByLabel("Device name")).toHaveValue(NAME);

  await page.reload();
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
  await expect(page.getByLabel("Device name")).toHaveValue(NAME);

  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await expect(page.getByText(NAME).first()).toBeVisible(); // the Review stage states the request
  await ackAll(page);
  await page.getByRole("button", { name: "Install firmware" }).click();
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText(`Applied and verified: ${NAME}`)).toBeVisible();
  expect(await keyWrites(page)).toEqual([{ op: "set", name: NAME }]);
});

test("O: names the key would refuse show their reason and block Continue", async ({ page }) => {
  await setup(page, {});
  await page.goto("/install");
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
  await page.getByRole("radio", { name: "Custom name" }).check();
  const field = page.getByLabel("Device name");
  await field.fill("Mêw");
  await expect(page.getByText("Use plain ASCII letters, digits, spaces and punctuation only (no accents or emoji).")).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await field.fill("x".repeat(32));
  await expect(page.getByText("Use at most 31 characters.")).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await field.fill(" Mew");
  await expect(page.getByText("Remove spaces at the start or end.")).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await field.fill("Mew");
  await expect(next(page)).toBeEnabled();
});

test("P: a management PIN is asked for, a wrong one shows the tries left, the right one applies the name", async ({ page }) => {
  await setup(page, { device: "blank", key: { enrolledPin: "123456" } });
  await installWithName(page, NAME);
  await page.getByRole("button", { name: "Check my key" }).click();
  const pin = page.getByLabel("Management PIN");
  await pin.fill("000000");
  await page.getByRole("button", { name: "Send PIN" }).click();
  await expect(page.getByText(/7 tries left/)).toBeVisible();
  await expect(pin).toHaveValue(""); // the PIN is cleared once it was sent
  await pin.fill("123456");
  await page.getByRole("button", { name: "Send PIN" }).click();
  await expect(page.getByText(`Applied and verified: ${NAME}`)).toBeVisible();
  expect(await keyWrites(page)).toEqual([{ op: "set", name: NAME }]);
});

test("Q: a missed BOOT press is reported with the command-line fallback", async ({ page }) => {
  await setup(page, { device: "blank", key: { button: "timeout" } });
  await installWithName(page, NAME);
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("The BOOT button wasn't pressed in time")).toBeVisible();
  await expect(page.getByText(CLI)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(await keyWrites(page)).toEqual([]);
});

test("R: keeping the name sends nothing to the key", async ({ page }) => {
  await setup(page, { device: "blank" });
  await installWithName(page, null);
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("Key detected: MultiKeys Security Key")).toBeVisible();
  await expect(page.getByText("Not requested — current name kept")).toBeVisible();
  expect(await keyWrites(page)).toEqual([]);
});

test("S: resetting to the default name clears the stored name", async ({ page }) => {
  await setup(page, { device: "blank", key: { name: "Alice", custom: true } });
  await page.goto("/install");
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
  await page.getByRole("radio", { name: "Reset to the default name" }).check();
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await ackAll(page);
  await page.getByRole("button", { name: "Install firmware" }).click();
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("Applied and verified: MultiKeys Security Key")).toBeVisible();
  expect(await keyWrites(page)).toEqual([{ op: "clear" }]);
});

test("T: a key that does not come back is reported as not confirmed", async ({ page }) => {
  await setup(page, { device: "blank", key: { reenumerate: "never" } });
  await installWithName(page, NAME);
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("The new name wasn't confirmed")).toBeVisible();
  await expect(page.getByText(`Applied and verified: ${NAME}`)).toHaveCount(0);
});

test("U: firmware without renaming support says so", async ({ page }) => {
  await setup(page, { device: "blank", key: { renameSupported: false } });
  await installWithName(page, NAME);
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("This firmware can't be renamed")).toBeVisible();
  expect(await keyWrites(page)).toEqual([]);
});

test("V: a legacy release cannot rename, and does not try", async ({ page }) => {
  await setup(page, { release: "legacy-v1", device: "blank" });
  await installWithName(page, NAME);
  await page.getByRole("button", { name: "Check my key" }).click();
  await expect(page.getByText("Key detected: MultiKeys Security Key")).toBeVisible();
  await expect(page.getByText("This firmware can't be renamed")).toBeVisible();
  expect(await keyWrites(page)).toEqual([]);
});

test("checksum mismatch stops with no way to continue", async ({ page }) => {
  await setup(page, { device: "blank" }, { corruptZip: true });
  await toChooser(page);
  const panel = page.getByTestId("error-panel");
  await expect(panel).toHaveAttribute("data-error-code", "checksum-mismatch");
  await expect(page.getByRole("button", { name: /continue|anyway/i })).toHaveCount(0);
});

test("foreign partition table -> repurpose needs REPURPOSE typed", async ({ page }) => {
  await setup(page, { device: "foreign" });
  await toChooser(page);
  await expect(page.getByTestId("install-mode")).toHaveText("Repurpose this board");
  await expect(page.getByText("Clear the part0 area")).toBeVisible();
  await ackAll(page);
  const install = page.getByRole("button", { name: "Install firmware" });
  await expect(install).toBeDisabled();
  await page.getByLabel(/Type REPURPOSE/).fill("repurpose");
  await expect(install).toBeDisabled();
  await page.getByLabel(/Type REPURPOSE/).fill("REPURPOSE");
  await expect(install).toBeEnabled();
});
