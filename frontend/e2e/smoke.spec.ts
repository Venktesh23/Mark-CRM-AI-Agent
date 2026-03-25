import { expect, test, type Page } from "@playwright/test";

async function ensureSignedIn(page: Page) {
  await page.goto("/");
  if (page.url().includes("/onboarding")) {
    const inputs = page.locator("input");
    await inputs.nth(0).fill("Student Dev");
    await inputs.nth(1).fill("student@example.com");
    await inputs.nth(2).fill("secret12");
    await inputs.nth(3).fill("secret12");
    await page.getByRole("button", { name: "Complete setup" }).click();
  } else if (page.url().includes("/login")) {
    await page.locator("input[type='password']").fill("secret12");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/$/);
}

test("first visit onboarding works", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding/);
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Student Dev");
  await inputs.nth(1).fill("student@example.com");
  await inputs.nth(2).fill("secret12");
  await inputs.nth(3).fill("secret12");
  await page.getByRole("button", { name: "Complete setup" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Meet Mark")).toBeVisible();
});

test("returning user can log out and log in", async ({ page }) => {
  await ensureSignedIn(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.locator("input[type='password']").fill("secret12");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("demo mode loads sample data from home", async ({ page }) => {
  await ensureSignedIn(page);
  await page.getByRole("button", { name: "Use demo data" }).click();
  await expect(page).toHaveURL(/\/create/);
});

test("create flow generates and navigates to review", async ({ page }) => {
  await ensureSignedIn(page);
  await page.getByRole("button", { name: "Use demo data" }).click();
  await page.getByPlaceholder("Describe your campaign... e.g. 'Create a 3-email spring sale campaign targeting EU customers aged 25-40. Include GDPR compliance, use a professional but friendly tone, and promote our new collection with a 30% discount code.'")
    .fill("Create a two email welcome campaign for new customers");
  await page.getByRole("button", { name: "Generate Campaign" }).click();
  await expect(page).toHaveURL(/\/review/);
  await expect(page.getByText("Review Your Campaign")).toBeVisible();
});

test("review modal supports edit interactions", async ({ page }) => {
  await ensureSignedIn(page);
  await page.getByRole("button", { name: "Use demo data" }).click();
  await page.getByPlaceholder("Describe your campaign... e.g. 'Create a 3-email spring sale campaign targeting EU customers aged 25-40. Include GDPR compliance, use a professional but friendly tone, and promote our new collection with a 30% discount code.'")
    .fill("Create a welcome campaign");
  await page.getByRole("button", { name: "Generate Campaign" }).click();
  await expect(page).toHaveURL(/\/review/);

  await page.locator("div.cursor-pointer").first().click();
  await page.getByRole("tab", { name: "Edit" }).click();
  await page.getByPlaceholder("Describe the changes you'd like, e.g. make the tone more formal, add a discount code section…")
    .fill("Make the language simpler.");
  await page.getByRole("button", { name: "Apply Changes" }).click();
  await expect(page.getByRole("button", { name: "Apply Changes" })).toBeDisabled();
});

test("send page supports manual recipients and mail config dialog", async ({ page }) => {
  await ensureSignedIn(page);
  await page.getByRole("button", { name: "Use demo data" }).click();
  await page.getByPlaceholder("Describe your campaign... e.g. 'Create a 3-email spring sale campaign targeting EU customers aged 25-40. Include GDPR compliance, use a professional but friendly tone, and promote our new collection with a 30% discount code.'")
    .fill("Create a simple campaign");
  await page.getByRole("button", { name: "Generate Campaign" }).click();
  await expect(page).toHaveURL(/\/review/);
  await page.getByRole("button", { name: "Save Campaign" }).click();
  await expect(page).toHaveURL(/\/campaigns\//);

  const cards = page.locator("div.cursor-pointer");
  const cardCount = await cards.count();
  for (let i = 0; i < cardCount; i += 1) {
    await cards.nth(i).click();
    await page.getByRole("tab", { name: "Approve" }).click();
    await page.getByLabel("Legal Approval").click();
    await page.getByLabel("Marketing Approval").click();
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
