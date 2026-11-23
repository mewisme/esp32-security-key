import { expect, test } from "@playwright/test";
import { makeFirmware } from "../fixtures/firmware";
import { setup } from "./helpers";
import type { Scenario } from "./scenario";

/** The app image hash of the 16 MB build the fake release server publishes. */
async function publishedAppSha(): Promise<string> {
  const fw = await makeFirmware();
  return fw.manifest.builds.find((b) => b.profile_id === "esp32s3-16mb")!.images.find((i) => i.role === "app")!.sha256;
}

async function open(page: Parameters<typeof setup>[0], scenario: Scenario) {
  await setup(page, scenario);
  await page.goto("/key");
  await page.getByRole("button", { name: /Connect key|Kết nối khóa/ }).click();
}

test.describe("Your key: firmware", () => {
  test("a key running a published image says which release it is", async ({ page }) => {
    await open(page, { key: { build: { imageSha256: await publishedAppSha(), version: "0.2.0", commit: "281fae077113" } } });
    await expect(page.getByTestId("published-match")).toContainText(/Exactly the image published as v0\.2\.0 \(16MB\)/);
    const card = page.getByTestId("firmware-card");
    await expect(card).toContainText("multikey-fido 0.2.0 (ESP-IDF v5.5.6)");
    await expect(card).toContainText("flash encryption off, secure boot off");
    await expect(card).toContainText("power-on, up 5 min 0 s");
    await expect(card).toContainText("factory @ 0x20000");
    await expect(page.getByTestId("image-sha256")).toHaveText(await publishedAppSha());
  });

  test("an unlisted image is flagged, and an uncommitted build is named as such", async ({ page }) => {
    await open(page, { key: { build: { imageSha256: "ee".repeat(32), commit: "281fae077113+dirty" } } });
    await expect(page.getByTestId("published-no-match")).toContainText("Not the image of any published release");
    await expect(page.getByTestId("firmware-card")).toContainText("not proof of tampering");
    await expect(page.getByTestId("firmware-card")).toContainText("Built from files with uncommitted changes.");
  });

  test("a key whose firmware predates BUILD_INFO is told to update, with a link to the installer", async ({ page }) => {
    await open(page, { key: {} });
    const warn = page.getByTestId("firmware-outdated");
    await expect(warn).toContainText("This firmware can't say what it is");
    await warn.getByRole("link", { name: "Install a newer release" }).click();
    await expect(page).toHaveURL(/\/install$/);
  });

  test("a key that is never chosen leaves nothing but a hint", async ({ page }) => {
    await setup(page, { chooser: "cancel" });
    await page.goto("/key");
    await page.getByRole("button", { name: "Connect key" }).click();
    await expect(page.getByText("No key was chosen.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect key" })).toBeEnabled();
    await expect(page.getByTestId("firmware-card")).toHaveCount(0);
  });
});

test.describe("Your key: passkey activity", () => {
  const events: NonNullable<Scenario["key"]>["events"] = [
    { afterMs: 0, queued: true, op: "get-assertion", result: "error", rpId: "example.org", authFlags: 0x01, credentialCount: 2, error: 0x2e },
    { afterMs: 150, op: "user-presence", result: "pending", operation: "make-credential", rpId: "github.com" },
    { afterMs: 300, op: "make-credential", result: "ok", rpId: "github.com", userName: "alice", userDisplayName: "Alice A.", algorithm: -7, authFlags: 0x45 },
    { afterMs: 450, op: "get-assertion", result: "ok", rpId: "github.com", userName: "alice", authFlags: 0x01, credentialCount: 3 },
  ];

  test("shows what the key had queued, then live events with their site, account and flags", async ({ page }) => {
    await open(page, { key: { build: { imageSha256: "ee".repeat(32) }, events } });
    await page.getByRole("button", { name: "Start watching" }).click();
    const items = page.getByTestId("activity-item");
    await expect(items).toHaveCount(4);
    // The queued event sits under its own heading: its time is unknown.
    const earlier = page.getByRole("region", { name: "Reported when you connected" });
    await expect(earlier).toContainText("Signing in to example.org failed");
    await expect(earlier).toContainText("NO_CREDENTIALS");
    await expect(earlier.locator("time")).toHaveCount(0);
    // Live events, newest first, with the host's clock.
    const live = page.getByRole("region", { name: "While you watched" });
    await expect(live.locator("li").first()).toContainText("Signed in to github.com");
    await expect(live.locator("li").first()).toContainText("3 passkeys matched");
    await expect(live).toContainText("Waiting for the BOOT button to create a passkey on github.com");
    const created = live.locator("li", { hasText: "Passkey created for github.com" });
    await expect(created).toContainText("Account: alice (Alice A.)");
    await expect(created).toContainText("Button pressed");
    await expect(created).toContainText("User verified");
    await expect(created).toContainText("ES256");
    await expect(live.locator("time")).toHaveCount(3);
    // The first sign-in had the button but no user verification.
    await expect(live.locator("li").first()).not.toContainText("User verified");
  });

  test("the lookup a browser makes before asking for a touch is not shown as a sign-in", async ({ page }) => {
    // Seen on a real key: Windows/Chrome send a getAssertion with up=false first; the key reports it as ok, UV set, UP clear.
    await open(page, {
      key: {
        build: { imageSha256: "ee".repeat(32) },
        events: [
          { afterMs: 50, op: "get-assertion", result: "ok", rpId: "github.com", userName: "alice", authFlags: 0x04, credentialCount: 1 },
          { afterMs: 150, op: "user-presence", result: "pending", operation: "get-assertion", rpId: "github.com" },
          { afterMs: 250, op: "get-assertion", result: "ok", rpId: "github.com", userName: "alice", authFlags: 0x05, credentialCount: 1 },
        ],
      },
    });
    await page.getByRole("button", { name: "Start watching" }).click();
    const items = page.getByTestId("activity-item");
    await expect(items).toHaveCount(3);
    await expect(items.filter({ hasText: "Signed in to github.com" })).toHaveCount(1);
    const lookup = items.filter({ hasText: "Looked up a passkey for github.com (no button press)" });
    await expect(lookup).toHaveCount(1);
    await expect(lookup).toContainText("No button press");
  });

  test("stopping ends the watch and keeps what was seen", async ({ page }) => {
    await open(page, { key: { build: { imageSha256: "ee".repeat(32) }, events } });
    await page.getByRole("button", { name: "Start watching" }).click();
    await expect(page.getByTestId("activity-item")).toHaveCount(4);
    await page.getByRole("button", { name: "Stop watching" }).click();
    await expect(page.getByRole("button", { name: "Start watching" })).toBeVisible();
    await expect(page.getByText("Not watching.")).toBeVisible();
    await expect(page.getByTestId("activity-item")).toHaveCount(4);
  });

  test("text from a site cannot smuggle control or direction-override characters onto the page", async ({ page }) => {
    const hostile = "evil\u001b[31m\u202e.example";
    await open(page, {
      key: { build: { imageSha256: "ee".repeat(32) }, events: [{ afterMs: 100, op: "make-credential", result: "ok", rpId: hostile, userName: "x\u0007y" }] },
    });
    await page.getByRole("button", { name: "Start watching" }).click();
    const row = page.getByTestId("activity-item");
    await expect(row).toHaveCount(1);
    const shown = await row.innerText();
    for (const dangerous of ["\u001b", "\u0007", "\u202e"]) expect(shown).not.toContain(dangerous);
    expect(shown).toContain("evil");
    expect(shown).toContain("\ufffd");
  });
});

test.describe("Your key: Vietnamese", () => {
  test.use({ locale: "vi-VN" });

  test("is translated, including the sentences built from an event", async ({ page }) => {
    await open(page, {
      key: { build: { imageSha256: "ee".repeat(32) }, events: [{ afterMs: 50, op: "make-credential", result: "ok", rpId: "github.com", userName: "alice", authFlags: 0x45 }] },
    });
    await expect(page.getByRole("heading", { name: "Khóa của bạn" })).toBeVisible();
    await expect(page.getByTestId("published-no-match")).toContainText("Không phải image của bản phát hành nào đã công bố");
    await page.getByRole("button", { name: "Bắt đầu theo dõi" }).click();
    await expect(page.getByTestId("activity-item")).toContainText("Đã tạo passkey cho github.com");
    await expect(page.getByTestId("activity-item")).toContainText("Đã nhấn nút");
  });
});

test("the header reaches the page", async ({ page }) => {
  await setup(page, {});
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Your key" }).click();
  await expect(page).toHaveURL(/\/key$/);
  await expect(page.getByRole("heading", { name: "Your key" })).toBeVisible();
});
