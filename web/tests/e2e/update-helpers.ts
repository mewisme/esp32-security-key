import { expect, type Page } from "@playwright/test";
import { type FirmwareFixture, makeFirmware } from "../fixtures/firmware";
import type { Scenario } from "./scenario";

export const APP = 0x20000;
export const TAG = "v0.3.3";
export const OLD_SHA = "11".repeat(32);

/** A fake server that publishes one release, v0.3.3, with or without `update.app_only`. */
export async function setupUpdate(
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

export const KEY_BEFORE: Scenario["key"] = { name: "My Key", build: { version: "0.3.1", imageSha256: OLD_SHA } };
export const running = (extra: Partial<Scenario> = {}) => (): Scenario => ({ device: "fido-0.3.1", key: KEY_BEFORE, ...extra });

export const next = (page: Page) => page.getByRole("button", { name: "Continue" });

/** Connect key -> Check for updates -> the download-mode chooser -> Review. */
export async function toReview(page: Page) {
  await page.goto("/update");
  await page.getByRole("button", { name: "Choose key" }).click();
  await expect(page.getByText("The key reports")).toBeVisible();
  await next(page).click();
  await expect(page.getByText("Offered")).toBeVisible();
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await expect(page.getByTestId("update-outcome")).toBeVisible();
}

export async function ackAll(page: Page) {
  for (const box of await page.getByRole("checkbox").all()) await box.check();
}
