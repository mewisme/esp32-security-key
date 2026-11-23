import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { makeFirmware } from "../fixtures/firmware";
import type { Scenario } from "./scenario";

export async function setup(page: Page, scenario: Scenario, opts: { corruptZip?: boolean; noSerial?: boolean } = {}) {
  const fw = await makeFirmware();
  const zip = Buffer.from(fw.zip);
  if (opts.corruptZip) zip[200] = zip[200]! ^ 0xff;
  await page.addInitScript(
    ([s, noSerial]) => {
      localStorage.setItem("multikeys-e2e-scenario", JSON.stringify(s));
      if (noSerial) Object.defineProperty(Navigator.prototype, "serial", { get: () => undefined });
    },
    [scenario, !!opts.noSerial] as const,
  );
  await page.route("**/api/releases", (r) =>
    r.fulfill({
      json: [{ tag: "v0.2.0", name: "MultiKeys v0.2.0", prerelease: false, published_at: "2026-11-23T00:00:00Z", html_url: "https://example.invalid/notes" }],
    }),
  );
  await page.route("**/api/firmware/v0.2.0/firmware-manifest.json", (r) => r.fulfill({ json: fw.manifest }));
  await page.route(`**/api/firmware/v0.2.0/${fw.build.package.name}`, (r) =>
    r.fulfill({ body: zip, headers: { "Content-Type": "application/zip" } }),
  );
  return fw;
}

/** Welcome -> hardware -> firmware -> connect -> device chooser. */
export async function toChooser(page: Page) {
  await page.goto("/install");
  await page.getByRole("button", { name: "Start installation" }).click();
  await page.getByText("ESP32-S3 N16R8 devkit with two USB ports").click();
  await page.getByText("My board has a BOOT button").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Version 0.2.0")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Choose device" }).click();
}

export async function ackAll(page: Page) {
  await expect(page.getByRole("button", { name: "Install firmware" })).toBeVisible();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
}
