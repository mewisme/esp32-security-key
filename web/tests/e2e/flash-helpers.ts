import { expect, type Page } from "@playwright/test";
import { makeFirmware } from "../fixtures/firmware";
import { HARDWARE_CHECK } from "./helpers";
import type { Scenario } from "./scenario";

export const APP = 0x20000;
export const OLD_SHA = "11".repeat(32);

export interface Rel {
  version: string;
  /** Declare `update.app_only`. Default true: most scenarios are about releases that support it. */
  appOnly?: boolean;
  downgradeFloor?: string;
}

/**
 * A fake server that publishes `releases` (newest first), each with its fido builds. `pendingRecord` seeds the
 * interrupted-write record (version 2) the page itself writes: same release and image as the newest one, on the fake chip's MAC.
 */
export async function setupFlash(
  page: Page,
  scenario: Scenario,
  releases: Rel[],
  opts: { pendingRecord?: boolean; pendingOverride?: Record<string, unknown> } = {},
) {
  const built = await Promise.all(
    releases.map(async (r) => ({ r, fw: await makeFirmware({ appOnly: r.appOnly ?? true, version: r.version, tag: `v${r.version}`, downgradeFloor: r.downgradeFloor }) })),
  );
  const newest = built[0]!;
  const appSha256 = newest.fw.manifest.builds.find((b) => b.image === "fido" && b.profile_id === "esp32s3-16mb")!.images.find((i) => i.role === "app")!.sha256;
  const record = {
    v: 2, project: "multikey-fido", imageFamily: "fido", fromVersion: "0.3.1", toVersion: newest.r.version, tag: `v${newest.r.version}`, profileId: "esp32s3-16mb", appSha256,
    chipMac: "80:b5:4e:c8:22:78", startedAt: new Date().toISOString(), ...opts.pendingOverride,
  };
  await page.addInitScript(
    ([s, rec]) => {
      localStorage.setItem("multikeys-e2e-scenario", JSON.stringify(s));
      if (rec && !sessionStorage.getItem("seeded")) {
        localStorage.setItem("multikeys-pending-update", JSON.stringify(rec));
        sessionStorage.setItem("seeded", "1");
      }
    },
    [scenario, opts.pendingRecord ? record : null] as const,
  );
  const summary = (tag: string, at: string) => ({ tag, name: `MultiKeys ${tag}`, prerelease: false, published_at: at, html_url: "https://example.invalid/notes" });
  await page.route("**/api/releases", (route) =>
    route.fulfill({ json: built.map(({ r }, i) => summary(`v${r.version}`, `2026-11-${String(24 - i).padStart(2, "0")}T00:00:00Z`)) }),
  );
  // Releases before signing have no signature file: the proxy answers 404 and the page marks them "Not authenticated".
  await page.route("**/firmware-manifest.json.sig", (route) => route.fulfill({ status: 404, json: { error: "not_found" } }));
  for (const { r, fw } of built) {
    await page.route(`**/api/firmware/v${r.version}/firmware-manifest.json`, (route) => route.fulfill({ json: fw.manifest }));
    for (const [name, bytes] of fw.zips) {
      const zip = Buffer.from(bytes);
      await page.route(`**/api/firmware/v${r.version}/${name}`, (route) => route.fulfill({ body: zip, headers: { "Content-Type": "application/zip" } }));
    }
  }
  return built.map((b) => b.fw);
}

export const KEY_BEFORE: Scenario["key"] = { name: "My Key", build: { version: "0.3.1", imageSha256: OLD_SHA } };

export const next = (page: Page) => page.getByRole("button", { name: "Continue" });

/** Get started -> the firmware stage. */
export async function toFirmware(page: Page) {
  await page.goto("/install");
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
  await expect(page.getByTestId("usb-preview").or(page.getByRole("radio", { name: "Keep current name" }))).toBeVisible();
  await expect(next(page)).toBeEnabled();
}

/** Firmware stage -> the download-mode chooser -> the review of what the page detected. `pick` selects another release first. */
export async function toReview(page: Page, pick?: string) {
  await toFirmware(page);
  if (pick) {
    await page.getByRole("combobox", { name: "Choose another version" }).click();
    await page.getByRole("option", { name: new RegExp(`v${pick.replaceAll(".", "\\.")}`) }).click();
  }
  await next(page).click();
  await page.getByRole("button", { name: "Choose device" }).click();
  await expect(page.getByTestId("install-mode").or(page.getByTestId("error-panel"))).toBeVisible();
}

export async function ackAll(page: Page) {
  await expect(page.getByRole("button", { name: "Install firmware" })).toBeVisible();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
}

export const pending = (page: Page) => page.evaluate(() => localStorage.getItem("multikeys-pending-update"));
