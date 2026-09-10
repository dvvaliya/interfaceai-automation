import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import { PlaywrightSurface } from "../surface/playwright-surface.js";
import { authenticateBankDemo } from "../targets/bank-demo/authenticate.js";

const memberIdSchema = z.string().regex(/^\d{5}$/, "Member ID must contain exactly five digits.");

export async function runActionCheck(
  config: AppConfig,
  memberIdInput: string,
  headed: boolean,
): Promise<void> {
  if (!config.BANK_OPERATOR_ID || !config.BANK_OPERATOR_PASSWORD) {
    throw new Error(
      "BANK_OPERATOR_ID and BANK_OPERATOR_PASSWORD must be configured for action-check.",
    );
  }

  const memberId = memberIdSchema.parse(memberIdInput);
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
    const before = await surface.observe("action-check-before");

    await surface.fill(
      { strategy: "role", role: "textbox", name: "Member Number" },
      memberId,
    );
    await surface.click({ strategy: "role", role: "button", name: "Search" });

    await page.getByRole("heading", { name: "Member Profile", exact: true }).waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const after = await surface.observe("action-check-after");
    const evidencePath = path.resolve("evidence", "action-check.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify({ memberId, before, after }, null, 2)}\n`,
      "utf8",
    );

    console.log(`Member ${memberId} opened successfully.`);
    console.log(`Final URL: ${after.url}`);
    console.log(`Evidence JSON: ${evidencePath}`);
    console.log(`Final screenshot: ${after.screenshotPath}`);
    console.log("Action check passed.");
  } finally {
    await browser.close();
  }
}
