import { test, expect } from "@playwright/test";
import {
  bootstrapDemoWorkspace,
  generateCampaignAndOpenReview,
  saveCampaignFromReview,
} from "./helpers";

test("P2 localization localizes generated review emails", async ({ page }) => {
  await bootstrapDemoWorkspace(page);
  await generateCampaignAndOpenReview(
    page,
    "Create a 2-email spring campaign for EU users with clear CTA."
  );

  await page.getByRole("button", { name: "Localize All Emails" }).click();
  await expect(page.getByText("Localization complete").first()).toBeVisible();
  await expect(page.getByText("Localization Agent")).toBeVisible();

  await saveCampaignFromReview(page);
});
