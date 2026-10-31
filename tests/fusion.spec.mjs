import { test, expect } from "@playwright/test";

test.describe("Fusion Panda", () => {
  test("smart fusion from vault seed", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.getElementById("agent-name")?.textContent?.length
    );
    await page.locator("#tab-fusion").click();
    await expect(page.locator("#fusion")).toBeVisible();
    await page.locator("#mode-smart").click();
    await page.locator("#fusion-use-current").check();
    await page.locator("#fusion-run").click();
    await expect(page.locator("#fusion-name")).not.toHaveText("Hybrid awaits", {
      timeout: 20000,
    });
    await expect(page.locator(".parent-card")).toHaveCount(2);
    await expect(page.locator("#fusion-md")).not.toBeEmpty();
    await page.screenshot({
      path: "docs/screenshots/after/fusion-smart.png",
      fullPage: true,
    });
  });

  test("chaos fusion reveal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#tab-fusion").click();
    await page.locator("#mode-chaos").click();
    await page.locator("#fusion-run").click();
    await expect(page.locator("#chaos-reveal")).toBeVisible({ timeout: 20000 });
    await page.locator("#fusion-save").click();
    await expect(page.locator("#toast")).toContainText("Saved");
    await page.screenshot({
      path: "docs/screenshots/after/fusion-chaos.png",
      fullPage: false,
    });
  });
});
