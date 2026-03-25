import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

const E2E_BYPASS_KEY = "mark.e2e.auth.bypass";

export async function enableAuthBypass(page: Page): Promise<void> {
  await page.goto("/welcome");
  await page.evaluate((key) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(key, "true");
  }, E2E_BYPASS_KEY);
}

export async function bootstrapDemoWorkspace(page: Page): Promise<void> {
  await enableAuthBypass(page);
  await page.goto("/?e2eBypass=1");
  await expect(page.getByRole("heading", { name: "Meet Mark" })).toBeVisible();
  const useDemoButton = page.getByRole("button", { name: "Use demo data" });
  if ((await useDemoButton.count()) === 0) {
    const reconnectButton = page.getByRole("button", { name: "Reconnect" });
    if ((await reconnectButton.count()) > 0) {
      await reconnectButton.click();
    }
  }
  await page.getByRole("button", { name: "Use demo data" }).click();
  await expect(page).toHaveURL(/\/create$/);
}

export async function generateCampaignAndOpenReview(page: Page, prompt: string): Promise<void> {
  await page.getByPlaceholder(/Describe your campaign/i).fill(prompt);
  await page.getByRole("button", { name: "Generate Campaign" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText("Review Your")).toBeVisible();
}

export async function saveCampaignFromReview(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save Campaign" }).click();
  await expect(page).toHaveURL(/\/campaigns\/.+/);
}
