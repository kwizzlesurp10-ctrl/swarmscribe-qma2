import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";

test.describe("SwarmScribe visuals", () => {
  test("desktop vault", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForSelector("#agent-name");
    await expect(page.locator("#agent-name")).toContainText("Coordinator");
    await page.screenshot({
      path: process.env.OUT_DESKTOP || "docs/screenshots/after/desktop.png",
      fullPage: true,
    });
  });

  test("mobile vault", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForSelector("#agent-name");
    await page.screenshot({
      path: process.env.OUT_MOBILE || "docs/screenshots/after/mobile.png",
      fullPage: true,
    });
  });

  test("search highlight and deep link", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/#critic`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.getElementById("agent-name")?.textContent === "Critic"
    );
    await page.locator("#rail-search").fill("crit");
    await page.waitForTimeout(200);
    await page.screenshot({
      path: process.env.OUT_SEARCH || "docs/screenshots/after/search-deeplink.png",
      fullPage: false,
    });
  });

  test("keyboard focus and copy toast", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: "load" });
    await page.keyboard.press("/");
    await expect(page.locator("#rail-search")).toBeFocused();
    await page.locator("#copy-sys").click();
    await page.waitForSelector(".toast.show");
    await expect(page.locator("#toast")).toContainText("copied");
    await page.screenshot({
      path: process.env.OUT_TOAST || "docs/screenshots/after/toast.png",
      fullPage: false,
    });
  });

  test("rendered markdown view and theme toggle", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("swarmscribe:theme"));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.locator("#view-rendered").click();
    await expect(page.locator("#prompt-md")).toBeVisible();
    const before = await page.locator("html").getAttribute("data-theme");
    await page.locator("#theme-toggle").click();
    const after = await page.locator("html").getAttribute("data-theme");
    expect(before).not.toEqual(after);
  });
});
