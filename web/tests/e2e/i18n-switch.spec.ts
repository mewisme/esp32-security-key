import { expect, type Page, test } from "@playwright/test";
import { ackAll, flashWrites, HARDWARE_CHECK, keyWrites, setup, toChooser, type ExtraRelease } from "./helpers";
import { running, setupUpdate, toReview, ackAll as ackUpdate, APP } from "./update-helpers";
import type { Scenario } from "./scenario";

/**
 * Changing the language is presentation only. These tests change it in the middle of work and check that
 * nothing the user typed, chose or started is lost, repeated or cancelled.
 */

const OLDER: ExtraRelease = { version: "0.1.5", publishedAt: "2026-10-01T00:00:00Z" };
/** The progress label while the images are being written, before it is finished (English only: asserted before switching). */
const MIDWAY = /^Written .* \((?:[1-9]|[1-9]\d)%\)$/;
const next = (page: Page) => page.getByRole("button", { name: "Continue" });

async function switchLang(page: Page, to: "vi" | "en") {
  await page.getByTestId("language-toggle").click();
  await page.getByRole("menuitemradio", { name: to === "vi" ? "Tiếng Việt" : "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", to);
  await expect(page.getByRole("menu")).toHaveCount(0);
}

const counter = (page: Page, name: string) => page.evaluate((n) => Number(Reflect.get(window, n)) || 0, name);

/** Index of the stepper's current step (display order, so it does not depend on the language). */
const stepIndex = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll("[aria-selected]")].findIndex((el) => el.getAttribute("aria-selected") === "true"));

async function toFirmwareStep(page: Page) {
  await page.goto("/install");
  await page.getByRole("checkbox", { name: HARDWARE_CHECK }).check();
  await next(page).click();
  await expect(page.locator("#name-custom")).toBeVisible();
}

test.describe("A-C: the Install form and wizard", () => {
  test("A: the chosen version, name mode and typed name survive a round trip between languages", async ({ page }) => {
    await setup(page, {}, { extraReleases: [OLDER] });
    await toFirmwareStep(page);
    await page.getByRole("combobox", { name: "Choose another version" }).click();
    await page.getByRole("option", { name: /v0\.1\.5/ }).click();
    await page.locator("#name-custom").check();
    const name = page.locator("#device-name");
    await name.fill("Mew's Security Key");
    await expect(next(page)).toBeEnabled();
    const step = await stepIndex(page);

    const same = async () => {
      await expect(page.locator("#release-select")).toContainText("v0.1.5");
      await expect(page.locator("#name-custom")).toBeChecked();
      await expect(name).toHaveValue("Mew's Security Key");
      await expect(page.getByRole("button", { name: /Continue|Tiếp tục/ })).toBeEnabled();
      expect(await stepIndex(page)).toBe(step);
    };
    await switchLang(page, "vi");
    await expect(page.getByRole("button", { name: "Tiếp tục" })).toBeVisible();
    await same();
    await name.focus();
    await switchLang(page, "en");
    await same();
  });

  test("B: an invalid name stays invalid, keeps its exact text, and its message follows the language", async ({ page }) => {
    await setup(page, {});
    await toFirmwareStep(page);
    await page.locator("#name-custom").check();
    const name = page.locator("#device-name");
    await name.fill("ä bad");
    const english = "Use plain ASCII letters, digits, spaces and punctuation only (no accents or emoji).";
    const vietnamese = "Chỉ dùng chữ cái ASCII thông thường";
    await expect(page.getByText(english)).toBeVisible();
    await expect(next(page)).toBeDisabled();

    await switchLang(page, "vi");
    await expect(page.getByText(vietnamese)).toBeVisible();
    await expect(page.getByText(english)).toHaveCount(0);
    await expect(name).toHaveValue("ä bad");
    await expect(page.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();

    await switchLang(page, "en");
    await expect(page.getByText(english)).toBeVisible();
    await expect(name).toHaveValue("ä bad");
    await expect(next(page)).toBeDisabled();

    // Whitespace is never trimmed for the user: the rule still fires in both languages.
    await name.fill(" Mew");
    await switchLang(page, "vi");
    await expect(name).toHaveValue(" Mew");
    await expect(page.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
  });

  test("C: the wizard stays on the Review stage, keeps its acknowledgements and asks the browser for nothing again", async ({ page }) => {
    await setup(page, {});
    await toChooser(page);
    await ackAll(page);
    const step = await stepIndex(page);
    const boxes = page.getByRole("checkbox");
    const total = await boxes.count();
    expect(total).toBeGreaterThan(0);
    const before = await counter(page, "__portRequests");

    await switchLang(page, "vi");
    await switchLang(page, "en");
    await expect(page.getByRole("button", { name: "Install firmware" })).toBeEnabled();
    expect(await stepIndex(page)).toBe(step);
    for (const box of await boxes.all()) await expect(box).toBeChecked();
    expect(await flashWrites(page)).toEqual([]);
    expect(await counter(page, "__portRequests")).toBe(before);
  });
});

test.describe("D: running operations are not repeated or cancelled", () => {
  test("an installation in progress finishes once, with each image written once", async ({ page }) => {
    await setup(page, { writeDelayMs: 200 });
    await toChooser(page);
    await ackAll(page);
    await page.getByRole("button", { name: "Install firmware" }).click();
    await expect(page.getByText(MIDWAY)).toBeVisible();
    await switchLang(page, "vi");
    await expect(page.getByRole("progressbar")).toBeVisible();
    await switchLang(page, "en");
    await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible({ timeout: 30_000 });
    expect(await flashWrites(page)).toEqual([0, 0x8000, 0x20000]);
    expect(await counter(page, "__portRequests")).toBe(1);
  });

  test("an update in progress finishes once, writing only the app image", async ({ page }) => {
    await setupUpdate(page, running({ writeDelayMs: 200 }));
    await toReview(page);
    await ackUpdate(page);
    await page.getByRole("button", { name: "Update application" }).click();
    await expect(page.getByText(MIDWAY)).toBeVisible();
    await switchLang(page, "vi");
    await switchLang(page, "en");
    await expect(page.getByRole("button", { name: "Check my key" })).toBeVisible({ timeout: 30_000 });
    expect(await flashWrites(page)).toEqual([APP]);
    expect(await counter(page, "__portRequests")).toBe(1);
    expect(await counter(page, "__keyConnects")).toBe(1);
  });

  test("a watched key keeps its connection and its activity list", async ({ page }) => {
    const key: Scenario["key"] = {
      build: { imageSha256: "ee".repeat(32) },
      events: [
        { afterMs: 0, queued: true, op: "get-assertion", result: "error", rpId: "example.org", authFlags: 0x01, credentialCount: 2, error: 0x2e },
        { afterMs: 900, op: "make-credential", result: "ok", rpId: "github.com", userName: "alice", algorithm: -7, authFlags: 0x45 },
        { afterMs: 1800, op: "get-assertion", result: "ok", rpId: "github.com", userName: "alice", authFlags: 0x01, credentialCount: 3 },
      ],
    };
    await setup(page, { key });
    await page.goto("/key");
    await page.getByRole("button", { name: "Connect key" }).click();
    await page.getByRole("button", { name: "Start watching" }).click();
    const items = page.getByTestId("activity-item");
    await expect(items).toHaveCount(1);
    await switchLang(page, "vi");
    await expect(items).toHaveCount(2);
    await switchLang(page, "en");
    await expect(items).toHaveCount(3);
    await page.waitForTimeout(600);
    await expect(items).toHaveCount(3);
    expect(await counter(page, "__keyConnects")).toBe(1);
  });

  test("a rename waiting for the management PIN keeps the typed PIN and is applied once", async ({ page }) => {
    await setup(page, { key: { enrolledPin: "123456" } });
    await page.goto("/first-use");
    await page.getByLabel("Device name").fill("Desk key");
    await page.getByRole("button", { name: "Apply name" }).click();
    const pin = page.getByLabel(/Management PIN|Mã PIN quản lý/);
    await pin.fill("123456");
    await switchLang(page, "vi");
    await expect(pin).toHaveValue("123456");
    await expect(page.getByLabel("Device name").or(page.getByLabel("Tên thiết bị"))).toBeVisible();
    await switchLang(page, "en");
    await expect(pin).toHaveValue("123456");
    expect(await keyWrites(page)).toEqual([]);
    await page.getByRole("button", { name: "Send PIN" }).click();
    await expect(page.getByText("Applied and verified: Desk key")).toBeVisible();
    expect(await keyWrites(page)).toEqual([{ op: "set", name: "Desk key" }]);
    expect(await counter(page, "__keyConnects")).toBe(1);
  });
});

test.describe("E: dialogs", () => {
  test("the phone menu is modal, and reopens in the language chosen while it was closed", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await setup(page, {});
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("link", { name: "Install" })).toBeVisible();
    // While the sheet is open the page behind it, language toggle included, is inert: nothing can change under it.
    await expect(page.getByRole("button", { name: "Language" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await switchLang(page, "vi");
    await page.getByRole("button", { name: "Mở menu" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "Cài đặt" })).toBeVisible();
  });
});
