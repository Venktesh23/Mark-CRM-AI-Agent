import { test, expect } from "@playwright/test";
import { bootstrapDemoWorkspace } from "./helpers";

test("auth guard allows dev bypass and demo workspace bootstrap", async ({ page }) => {
  await bootstrapDemoWorkspace(page);
  await expect(page.getByRole("button", { name: "Generate Campaign" })).toBeVisible();
});
