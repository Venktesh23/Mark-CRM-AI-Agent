import { test, expect } from "@playwright/test";
import {
  bootstrapDemoWorkspace,
  generateCampaignAndOpenReview,
  saveCampaignFromReview,
} from "./helpers";

test("P2 content repurposing generates channel assets", async ({ page }) => {
  await bootstrapDemoWorkspace(page);
  await generateCampaignAndOpenReview(
    page,
    "Create an offer campaign with two variants for active members."
  );
  await saveCampaignFromReview(page);

  const repurposeCard = page.locator("div", { hasText: "Content Repurposing Agent" }).first();
  await repurposeCard.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText("Repurposed content ready")).toBeVisible();
  await expect(page.getByText("social_post:")).toBeVisible();
});
