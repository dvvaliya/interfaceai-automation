import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { generateMemberBalanceArtifact } from "../artifacts/generator.js";
import { saveCapabilityArtifact } from "../artifacts/store.js";
import type { AppConfig } from "../config/env.js";
import { runAgentLoop, type AgentLoopResult } from "../discovery/agent-loop.js";
import { parseDiscoveryRequest } from "../discovery/request.js";
import { createLlmProvider } from "../llm/factory.js";
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
): Promise<AgentLoopResult> {
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
    const provider = createLlmProvider(config);
    const result = await runAgentLoop({
      goal: request.goal,
      provider,
      surface,
      policy,
      maxSteps: config.DISCOVERY_MAX_STEPS,
      timeoutMs: config.DISCOVERY_TIMEOUT_MS,
    });
    let artifactPath: string | undefined;
    if (result.status === "completed") {
      const artifact = generateMemberBalanceArtifact(request, result);
      artifactPath = await saveCapabilityArtifact(artifact);
    }

    const evidencePath = path.resolve("evidence", "discovery-run.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        { request, provider: provider.name, result, artifactPath },
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(`Discovery status: ${result.status}`);
    console.log(`Steps: ${result.steps.length}`);
    if (result.status === "completed") {
      console.log(`Summary: ${result.summary}`);
      console.log("Outputs:");
      console.log(JSON.stringify(result.outputs, null, 2));
      console.log(`Artifact: ${artifactPath}`);
    } else {
      console.log(`Reason: ${result.reason}`);
    }
    console.log(`Evidence JSON: ${evidencePath}`);

    if (result.status === "failed") {
      throw new Error(`Discovery failed at step ${result.failedStep}: ${result.reason}`);
    }

    return result;
  } finally {
    await browser.close();
  }
}
