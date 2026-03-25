import { test, expect } from "@playwright/test";

test("landing, signup, and login navigation works", async ({ page }) => {
  await page.goto("/welcome");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/welcome");
  await expect(page.getByText("Build and send better campaigns with")).toBeVisible();

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await page.getByRole("link", { name: "Back to landing" }).click();
  await expect(page).toHaveURL(/\/welcome$/);

  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
