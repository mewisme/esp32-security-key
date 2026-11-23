import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { type FirmwareFixture, makeFirmware, makeLegacyFirmware } from "../fixtures/firmware";
import type { Scenario } from "./scenario";

export const HARDWARE_CHECK = "My board is an ESP32-S3 with a native USB connector and a BOOT button";

export interface ExtraRelease {
  version: string;
  prerelease?: boolean;
  publishedAt: string;
}

export async function setup(
  page: Page,
  scenario: Scenario,
  opts: { corruptZip?: boolean; noSerial?: boolean; extraReleases?: ExtraRelease[] } = {},
): Promise<FirmwareFixture> {
  const fw = scenario.release === "legacy-v1" ? await makeLegacyFirmware() : await makeFirmware({ images: scenario.images });
  await page.addInitScript(
    ([s, noSerial]) => {
      localStorage.setItem("multikeys-e2e-scenario", JSON.stringify(s));
      if (noSerial) Object.defineProperty(Navigator.prototype, "serial", { get: () => undefined });
    },
    [scenario, !!opts.noSerial] as const,
  );
  const extras = opts.extraReleases ?? [];
  const summary = (tag: string, name: string, prerelease: boolean, published_at: string) => ({ tag, name, prerelease, published_at, html_url: "https://example.invalid/notes" });
  await page.route("**/api/releases", (r) =>
    r.fulfill({
      json: [
        summary("v0.2.0", "MultiKeys v0.2.0", false, "2026-11-23T00:00:00Z"),
        ...extras.map((e) => summary(`v${e.version}`, `MultiKeys v${e.version}`, e.prerelease ?? false, e.publishedAt)),
      ],
    }),
  );
  await page.route("**/api/firmware/v0.2.0/firmware-manifest.json", (r) => r.fulfill({ json: fw.manifest }));
  for (const e of extras) {
    const extra = await makeFirmware({ images: scenario.images, version: e.version });
    await page.route(`**/api/firmware/v${e.version}/firmware-manifest.json`, (r) => r.fulfill({ json: extra.manifest }));
  }
  for (const [name, zipBytes] of fw.zips) {
    const zip = Buffer.from(zipBytes);
    if (opts.corruptZip) zip[200] = zip[200]! ^ 0xff;
    await page.route(`**/api/firmware/v0.2.0/${name}`, (r) => r.fulfill({ body: zip, headers: { "Content-Type": "application/zip" } }));
  }
  return fw;
}

/** Get started -> Firmware & name -> Connect & verify's device chooser, with every default accepted. */
export async function toChooser(page: Page) {
  await page.goto("/install");
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Choose device" }).click();
}

export async function ackAll(page: Page) {
  await expect(page.getByRole("button", { name: "Install firmware" })).toBeVisible();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
}

/** Records the firmware packages the page downloads, by file name. */
export function recordDownloads(page: Page): string[] {
  const names: string[] = [];
  page.on("request", (req) => {
    const m = /\/api\/firmware\/[^/]+\/(multikey-firmware-[^/]+\.zip)$/.exec(new URL(req.url()).pathname);
    if (m?.[1]) names.push(m[1]);
  });
  return names;
}

/** Writes the simulated key has accepted so far (`{op: "set" | "clear", name?}`), see tests/e2e/fake-create-key-connector.ts. */
export function keyWrites(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const writes: unknown = Reflect.get(window, "__keyWrites");
    return Array.isArray(writes) ? writes : [];
  });
}

/** Offsets the simulated board's flash received writes at, in order (see tests/e2e/fake-create-driver.ts). */
export function flashWrites(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const writes: unknown = Reflect.get(window, "__flashWrites");
    return Array.isArray(writes) ? writes.filter((w): w is number => typeof w === "number") : [];
  });
}
