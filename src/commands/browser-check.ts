import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { AppConfig } from "../config/env.js";

export async function runBrowserCheck(config: AppConfig, headed: boolean): Promise<void> {
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

    const screenshotDirectory = path.resolve("evidence");
    const screenshotPath = path.join(screenshotDirectory, "browser-check.png");
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(`Page title: ${await page.title()}`);
    console.log(`Final URL: ${page.url()}`);
    console.log(`Screenshot: ${screenshotPath}`);
    console.log("Browser check passed.");
  } finally {
    await browser.close();
  }
}
