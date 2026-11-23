import { expect, test } from "@playwright/test";
import { ackAll, setup, toChooser } from "./helpers";

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

test("C: wrong chip and wrong flash size stop before anything is written", async ({ page }) => {
  await setup(page, { chip: "ESP32" });
  await toChooser(page);
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "unsupported-chip");

  const p2 = await page.context().newPage();
  await setup(p2, { flashSize: "8MB" });
  await toChooser(p2);
  await expect(p2.getByTestId("error-panel")).toHaveAttribute("data-error-code", "wrong-flash-size");
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
  await page.getByRole("button", { name: "Start installation" }).click();
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "browser-unsupported");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("F: disconnect at 40% -> disconnected-during-flash, never completed", async ({ page }) => {
  await setup(page, { device: "blank", disconnectAt: 0.4 });
  await toChooser(page);
  await ackAll(page);
  await page.getByRole("button", { name: "Install firmware" }).click();
  await expect(page.getByTestId("error-panel")).toHaveAttribute("data-error-code", "disconnected-during-flash");
  await expect(page.getByText("Installation finished")).toHaveCount(0);
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
