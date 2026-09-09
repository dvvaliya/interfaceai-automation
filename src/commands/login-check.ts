import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { AppConfig } from "../config/env.js";
import { authenticateBankDemo } from "../targets/bank-demo/authenticate.js";

export async function runLoginCheck(config: AppConfig, headed: boolean): Promise<void> {
  if (!config.BANK_OPERATOR_ID || !config.BANK_OPERATOR_PASSWORD) {
    throw new Error(
      "BANK_OPERATOR_ID and BANK_OPERATOR_PASSWORD must be configured for login-check.",
    );
  }

  console.log(`Opening ${config.BANK_APP_URL}`);

  const browser = await chromium.launch({ headless: !headed });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const response = await page.goto(config.BANK_APP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    if (!response) {
      throw new Error("The bank application did not return an HTTP response.");
    }

    if (!response.ok()) {
      throw new Error(`The bank application returned HTTP ${response.status()}.`);
    }

    await authenticateBankDemo(page, {
      operatorId: config.BANK_OPERATOR_ID,
      password: config.BANK_OPERATOR_PASSWORD,
    });

    const screenshotDirectory = path.resolve("evidence");
    const screenshotPath = path.join(screenshotDirectory, "login-check.png");
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log("Logged in successfully.");
    console.log(`Final URL: ${page.url()}`);
    console.log(`Screenshot: ${screenshotPath}`);
    console.log("Login check passed.");
  } finally {
    await browser.close();
  }
}
