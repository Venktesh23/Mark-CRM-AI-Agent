import { expect, test } from "@playwright/test";
import {
  bootstrapDemoWorkspace,
  generateCampaignAndOpenReview,
  saveCampaignFromReview,
} from "./helpers";

test("demo mode loads sample data from home", async ({ page }) => {
  await bootstrapDemoWorkspace(page);
  await expect(page).toHaveURL(/\/create/);
});

test("create flow generates and navigates to review", async ({ page }) => {
  await bootstrapDemoWorkspace(page);
  await generateCampaignAndOpenReview(page, "Create a two-email welcome campaign for new users.");
});

test("review modal supports edit interactions", async ({ page }) => {
  await bootstrapDemoWorkspace(page);
  await generateCampaignAndOpenReview(page, "Create a welcome campaign for users.");

  await page.locator("div.cursor-pointer").first().click();
  await page.getByRole("tab", { name: "Edit" }).click();
  await page
    .getByPlaceholder("Describe the changes you'd like, e.g. make the tone more formal, add a discount code section…")
    .fill("Make the language simpler.");
  await page.getByRole("button", { name: "Apply Changes" }).click();
  await expect(page.getByRole("button", { name: "Apply Changes" })).toBeDisabled();
});

test("send page supports manual recipients and mail config dialog", async ({ page }) => {
  await bootstrapDemoWorkspace(page);
  await generateCampaignAndOpenReview(page, "Create a simple campaign.");
  await saveCampaignFromReview(page);

  const cards = page.locator("div.cursor-pointer");
  const cardCount = await cards.count();
  for (let i = 0; i < cardCount; i += 1) {
    await cards.nth(i).click();
    await page.getByRole("tab", { name: "Approve" }).click();
    await page.getByRole("checkbox").nth(0).click();
    await page.getByRole("checkbox").nth(1).click();
    await page.keyboard.press("Escape");
  }

  await page.getByRole("button", { name: "Send Campaign" }).click();
  await expect(page).toHaveURL(/\/send/);

  const manualTabs = page.getByRole("tab", { name: "Manual" });
  const manualCount = await manualTabs.count();
  for (let i = 0; i < manualCount; i += 1) {
    await manualTabs.nth(i).click();
  }
  const recipientAreas = page.getByPlaceholder("Enter email addresses separated by commas or new lines...");
  const areaCount = await recipientAreas.count();
  for (let i = 0; i < areaCount; i += 1) {
    await recipientAreas.nth(i).fill(`demo${i + 1}@example.com`);
  }
  await page.getByRole("button", { name: "Configure Mailing" }).click();
  await page.getByPlaceholder("noreply@yourcompany.com").fill("demo@example.com");
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});
