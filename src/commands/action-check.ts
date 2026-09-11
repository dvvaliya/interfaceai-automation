import { chromium } from "playwright";
import { z } from "zod";
import { executeAction } from "../actions/executor.js";
import { parseAgentAction } from "../actions/schema.js";
import type { AppConfig } from "../config/env.js";
import {
  assertPolicyAllows,
  createActionPolicy,
  evaluateActionPolicy,
} from "../policy/action-policy.js";
import { RunEvidence } from "../observability/run-evidence.js";
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
  const runEvidence = await RunEvidence.create("check", { redactionValues: [memberId] });
  runEvidence.record("action_check_started", { target: config.BANK_APP_URL, memberId });

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

    const surface = new PlaywrightSurface(page, runEvidence.screenshotsDirectory);
    const policy = createActionPolicy(config);
    const before = await surface.observe("action-check-before");

    const actions = [
      parseAgentAction({
        type: "fill",
        target: { strategy: "role", role: "textbox", name: "Member Number" },
        value: memberId,
        reason: "Enter the member requested by the action check.",
      }),
      parseAgentAction({
        type: "click",
        target: { strategy: "role", role: "button", name: "Search" },
        reason: "Submit the member search.",
      }),
    ];

    const policyDecisions = [];
    for (const action of actions) {
      const decision = evaluateActionPolicy(policy, action, { currentUrl: page.url() });
      policyDecisions.push(decision);
      assertPolicyAllows(decision);
      await executeAction(surface, action);
    }

    await page.getByRole("heading", { name: "Member Profile", exact: true }).waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const after = await surface.observe("action-check-after");
    runEvidence.record("action_check_passed", {
      memberId,
      actions,
      policyDecisions,
      finalUrl: after.url,
    });
    const evidencePath = await runEvidence.writeJson("result.json", {
      memberId,
      actions,
      policyDecisions,
      before,
      after,
    });

    console.log(`Member ${memberId} opened successfully.`);
    console.log(`Final URL: ${after.url}`);
    console.log(`Evidence JSON: ${evidencePath}`);
    console.log(`Final screenshot: ${after.screenshotPath}`);
    console.log("Action check passed.");
  } finally {
    await runEvidence.flush();
    await browser.close();
  }
}
