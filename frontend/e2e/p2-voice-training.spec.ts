import { test, expect } from "@playwright/test";
import { bootstrapDemoWorkspace } from "./helpers";

test("P2 voice training generates a reusable profile", async ({ page }) => {
  await bootstrapDemoWorkspace(page);
  await page.goto("/brand");

  await page.getByRole("tab", { name: "Voice Training" }).click();
  await page.getByRole("button", { name: "Train Voice Profile" }).click();

  await expect(page.getByText("Voice profile trained")).toBeVisible();
  await expect(page.getByText("Trained Voice Profile")).toBeVisible();
});
