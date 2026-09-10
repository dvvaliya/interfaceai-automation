import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { AppConfig } from "../config/env.js";
import { parseDiscoveryRequest, type DiscoveryRequest } from "../discovery/request.js";
import {
  assertPolicyAllows,
  createActionPolicy,
  evaluateLocationPolicy,
  evaluateOriginPolicy,
} from "../policy/action-policy.js";
import { PlaywrightSurface } from "../surface/playwright-surface.js";
import { authenticateBankDemo } from "../targets/bank-demo/authenticate.js";

export async function runDiscover(
  config: AppConfig,
  goal: string,
  targetOverride?: string,
  headed = false,
): Promise<DiscoveryRequest> {
  const request = parseDiscoveryRequest({
    goal,
    target: targetOverride ?? config.BANK_APP_URL,
  });

  console.log("Discovery request accepted.");
  console.table({
    goal: request.goal,
    target: request.target,
  });

  if (!config.BANK_OPERATOR_ID || !config.BANK_OPERATOR_PASSWORD) {
    throw new Error(
      "BANK_OPERATOR_ID and BANK_OPERATOR_PASSWORD must be configured for discovery.",
    );
  }

  const policy = createActionPolicy(config);
  assertPolicyAllows(evaluateOriginPolicy(policy, request.target));

  const browser = await chromium.launch({ headless: !headed });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const response = await page.goto(request.target, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    if (!response) {
      throw new Error("The target application did not return an HTTP response.");
    }

    if (!response.ok()) {
      throw new Error(`The target application returned HTTP ${response.status()}.`);
    }

    assertPolicyAllows(evaluateLocationPolicy(policy, page.url()));

    await authenticateBankDemo(page, {
      operatorId: config.BANK_OPERATOR_ID,
      password: config.BANK_OPERATOR_PASSWORD,
    });

    assertPolicyAllows(evaluateLocationPolicy(policy, page.url()));

    const surface = new PlaywrightSurface(page);
    const initialObservation = await surface.observe("discovery-initial");
    const evidencePath = path.resolve("evidence", "discovery-request.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify({ request, initialObservation }, null, 2)}\n`,
      "utf8",
    );

    console.log("Initial authenticated observation captured.");
    console.log(`Current URL: ${initialObservation.url}`);
    console.log(`Evidence JSON: ${evidencePath}`);
    console.log(`Screenshot: ${initialObservation.screenshotPath}`);
    console.log("LLM execution is not connected yet.");
  } finally {
    await browser.close();
  }

  return request;
}
