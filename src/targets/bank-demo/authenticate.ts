import type { Page } from "playwright";

export type BankDemoCredentials = {
  operatorId: string;
  password: string;
};

export async function authenticateBankDemo(
  page: Page,
  credentials: BankDemoCredentials,
): Promise<void> {
  // The form is server-rendered, so wait until its client-side submit handler is attached.
  await page.waitForLoadState("networkidle", { timeout: 10_000 });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.getByLabel("Operator ID").fill(credentials.operatorId);
    await page.getByLabel("Password").fill(credentials.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    try {
      await page.getByRole("heading", { name: "Member Inquiry" }).waitFor({
        state: "visible",
        timeout: 10_000,
      });
      return;
    } catch (error) {
      if (attempt === 2 || !new URL(page.url()).pathname.startsWith("/login")) {
        throw error;
      }
    }
  }
}
