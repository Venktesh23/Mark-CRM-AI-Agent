import { test, expect } from "@playwright/test";

test("landing, signup, and login navigation works", async ({ page }) => {
  await page.goto("/welcome");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/welcome");
  await expect(page.getByText("Build and send better campaigns with")).toBeVisible();

  await page.getByRole("button", { name: "No account? Create one" }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();

  await page.getByRole("button", { name: "Already have an account? Sign in" }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
