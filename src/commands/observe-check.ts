import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { AppConfig } from "../config/env.js";
import { PlaywrightSurface } from "../surface/playwright-surface.js";
import { authenticateBankDemo } from "../targets/bank-demo/authenticate.js";

export async function runObserveCheck(config: AppConfig, headed: boolean): Promise<void> {
  if (!config.BANK_OPERATOR_ID || !config.BANK_OPERATOR_PASSWORD) {
    throw new Error(
      "BANK_OPERATOR_ID and BANK_OPERATOR_PASSWORD must be configured for observe-check.",
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

    const surface = new PlaywrightSurface(page);
    const observation = await surface.observe("observe-check");
    const observationPath = path.resolve("evidence", "observe-check.json");
    await writeFile(observationPath, `${JSON.stringify(observation, null, 2)}\n`, "utf8");

    console.log("Page observation:");
    console.log(observation.accessibilitySnapshot);
    console.log(`Observation JSON: ${observationPath}`);
    console.log(`Screenshot: ${observation.screenshotPath}`);
    console.log("Observe check passed.");
  } finally {
    await browser.close();
  }
}
