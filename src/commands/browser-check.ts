import path from "node:path";
import { chromium } from "playwright";
import type { AppConfig } from "../config/env.js";
import { repositoryRoot } from "../observability/paths.js";
import { RunEvidence } from "../observability/run-evidence.js";

export async function runBrowserCheck(config: AppConfig, headed: boolean): Promise<void> {
  console.log(`Opening ${config.BANK_APP_URL}`);
  const runEvidence = await RunEvidence.create("check");
  runEvidence.record("browser_check_started", { target: config.BANK_APP_URL });

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

    const screenshotPath = path.join(runEvidence.screenshotsDirectory, "browser-check.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const result = {
      status: "success",
      title: await page.title(),
      finalUrl: page.url(),
      screenshotPath: path.relative(repositoryRoot, screenshotPath),
    };
    runEvidence.record("browser_check_passed", result);
    await runEvidence.writeJson("result.json", result);
    console.log(`Page title: ${result.title}`);
    console.log(`Final URL: ${result.finalUrl}`);
    console.log(`Screenshot: ${screenshotPath}`);
    console.log("Browser check passed.");
  } finally {
    await runEvidence.flush();
    await browser.close();
  }
}
