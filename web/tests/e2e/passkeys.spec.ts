import { type CDPSession, expect, type Page, test } from "@playwright/test";

/**
 * Chromium's virtual authenticator: a CTAP2 USB key that stores discoverable credentials and answers presence on demand.
 * It is UV-capable because Chromium refuses a discoverable credential on a virtual key that can neither verify the user nor
 * advertise makeCredUvNotRqd (the real key advertises it, docs/FIDO_UV.md); so the UV chip is set here and the test ignores it.
 */
async function virtualKey(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

const run = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^(Run|Run again): ${name}$`) });
const status = (page: Page, id: string) => page.getByTestId(`status-${id}`);

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("the key passes the four tests, and the inspector shows what it reported", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchConsole(page);
  const { cdp, authenticatorId } = await virtualKey(page);
  await page.goto("/passkeys");
  await expect(page.getByRole("heading", { name: "Passkey lab", level: 1 })).toBeVisible();
  await expect(page.getByTestId("score")).toHaveText("0 of 4 passed");

  // The other tests wait for a passkey.
  for (const name of ["Sign in with this passkey", "Sign in without choosing", "Don't touch"]) await expect(run(page, name)).toBeDisabled();

  await run(page, "Register a passkey").click();
  await expect(status(page, "register")).toHaveText("Passed");
  const inspector = page.getByTestId("inspector-result");
  await expect(inspector).toHaveAttribute("data-test", "register");
  await expect(page.getByTestId("flag-up")).toHaveAttribute("data-set", "true");
  await expect(page.getByTestId("check-userPresence")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("check-residentKey")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("credential-id")).toHaveText(/^[0-9a-f]{16}…$/);

  await run(page, "Sign in with this passkey").click();
  await expect(status(page, "signIn")).toHaveText("Passed");
  await expect(inspector).toHaveAttribute("data-test", "signIn");
  await expect(page.getByTestId("check-signature")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("check-credential")).toHaveAttribute("data-ok", "true");

  await run(page, "Sign in without choosing").click();
  await expect(status(page, "discoverable")).toHaveText("Passed");
  await expect(page.getByTestId("check-signature")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("score")).toHaveText("3 of 4 passed");
  await expect(page.getByTestId("all-passed")).toHaveCount(0);

  // Nobody touches the key: the browser gives up after the lab's 15 s and that is the pass.
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
  await run(page, "Don't touch").click();
  await expect(status(page, "refusal")).toHaveText("Waiting, don't touch");
  await expect(page.getByTestId("key-visual")).toHaveAttribute("data-state", "waiting");
  await expect(status(page, "refusal")).toHaveText("Passed", { timeout: 25_000 });
  await expect(page.getByTestId("score")).toHaveText("4 of 4 passed");
  await expect(page.getByTestId("all-passed")).toContainText("Your key works as a passkey");
  await expect(page.getByTestId("key-visual")).toHaveAttribute("data-state", "success");
  expect(errors).toEqual([]);
});

test("a key that signs without a touch fails the refusal test", async ({ page }) => {
  const { cdp, authenticatorId } = await virtualKey(page);
  await page.goto("/passkeys");
  await run(page, "Register a passkey").click();
  await expect(status(page, "register")).toHaveText("Passed");
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true });
  await run(page, "Don't touch").click();
  await expect(status(page, "refusal")).toHaveText("Failed");
  await expect(page.getByTestId("refusal-result")).toContainText("A signature came back");
  await expect(page.getByTestId("score")).toHaveText("1 of 4 passed");
});

test("registering again starts the track over", async ({ page }) => {
  await virtualKey(page);
  await page.goto("/passkeys");
  await run(page, "Register a passkey").click();
  await expect(status(page, "register")).toHaveText("Passed");
  await run(page, "Sign in with this passkey").click();
  await expect(status(page, "signIn")).toHaveText("Passed");
  await run(page, "Register a passkey").click();
  await expect(page.getByTestId("inspector-result")).toHaveAttribute("data-test", "register");
  await expect(status(page, "signIn")).toHaveText("Not run");
  await expect(page.getByTestId("score")).toHaveText("1 of 4 passed");
});

test("a browser without WebAuthn gets the explanation and no tests", async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "PublicKeyCredential"));
  await page.goto("/passkeys");
  await expect(page.getByTestId("not-supported")).toContainText("This browser can't do passkeys");
  await expect(page.getByTestId("test-register")).toHaveCount(0);
});

test("First use leads to the lab, and the header marks it as the current page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/first-use");
  await page.getByRole("link", { name: "Open the Passkey lab" }).click();
  await expect(page).toHaveURL(/\/passkeys$/);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Passkeys" })).toHaveAttribute("aria-current", "page");
});

/** Names of the CSS animations running while a registration waits for a touch nobody gives. */
async function waitingAnimations(page: Page): Promise<string[]> {
  const { cdp, authenticatorId } = await virtualKey(page);
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
  await page.goto("/passkeys");
  await run(page, "Register a passkey").click();
  await expect(status(page, "register")).toHaveText("Waiting for touch");
  await expect(page.getByTestId("key-visual")).toHaveAttribute("data-state", "waiting");
  return page.evaluate(() => document.getAnimations().map((a) => (a instanceof CSSAnimation ? a.animationName : "")));
}

test.describe("motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  // The control for the reduced-motion test below.
  test("a ring pulses around BOOT and a countdown runs while a test waits for a touch", async ({ page }) => {
    const names = await waitingAnimations(page);
    expect(names).toContain("pulse-ring-svg");
    expect(names).toContain("countdown");
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the ring is gone and the countdown stays while a test waits for a touch", async ({ page }) => {
    const names = await waitingAnimations(page);
    expect(names).not.toContain("pulse-ring-svg");
    expect(names).toContain("countdown");
  });
});

test.describe("Vietnamese browser", () => {
  test.use({ locale: "vi-VN" });

  test("the lab speaks Vietnamese", async ({ page }) => {
    await page.goto("/passkeys");
    await expect(page.getByRole("heading", { name: "Phòng thử passkey", level: 1 })).toBeVisible();
    await expect(page.getByTestId("score")).toHaveText("Đạt 0 trên 4");
  });
});
