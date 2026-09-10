import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { loadCapabilityArtifact } from "../artifacts/loader.js";
import type { AppConfig } from "../config/env.js";
import {
  assertPolicyAllows,
  createActionPolicy,
  evaluateLocationPolicy,
  evaluateOriginPolicy,
} from "../policy/action-policy.js";
import { executeReplay, type ReplayResult } from "../replay/executor.js";
import { resolveReplayInputs } from "../replay/inputs.js";
import { resolveReplaySteps } from "../replay/plan.js";
import { PlaywrightSurface } from "../surface/playwright-surface.js";
import { authenticateBankDemo } from "../targets/bank-demo/authenticate.js";

export async function runReplay(
  config: AppConfig,
  artifactPath: string,
  inputAssignments: readonly string[],
  headed: boolean,
): Promise<ReplayResult> {
  const artifact = await loadCapabilityArtifact(artifactPath);
  const inputs = resolveReplayInputs(artifact.inputs, inputAssignments);
  const steps = resolveReplaySteps(artifact, inputs);
  const entryOrigin = new URL(artifact.surface.entryUrl).origin;

  if (!artifact.surface.allowedOrigins.includes(entryOrigin)) {
    throw new Error(`Artifact entry origin '${entryOrigin}' is not allowed by the artifact.`);
  }
  if (!config.BANK_OPERATOR_ID || !config.BANK_OPERATOR_PASSWORD) {
    throw new Error("Bank operator credentials must be configured for replay.");
  }

  const policy = createActionPolicy(config);
  assertPolicyAllows(evaluateOriginPolicy(policy, artifact.surface.entryUrl));

  const browser = await chromium.launch({ headless: !headed });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const response = await page.goto(artifact.surface.entryUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    if (!response?.ok()) {
      throw new Error(`Target application returned HTTP ${response?.status() ?? "unknown"}.`);
    }

    assertPolicyAllows(evaluateLocationPolicy(policy, page.url()));
    await authenticateBankDemo(page, {
      operatorId: config.BANK_OPERATOR_ID,
      password: config.BANK_OPERATOR_PASSWORD,
    });
    assertPolicyAllows(evaluateLocationPolicy(policy, page.url()));

    const surface = new PlaywrightSurface(page);
    const result = await executeReplay({ artifact, steps, surface, policy });
    const evidencePath = path.resolve("evidence", "replay-run.json");
    const redactedInputs = Object.fromEntries(
      Object.entries(inputs).map(([name, value]) => [
        name,
        artifact.inputs[name]?.sensitive ? "[REDACTED]" : value,
      ]),
    );
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          capability: artifact.id,
          capabilityVersion: artifact.capabilityVersion,
          inputs: redactedInputs,
          result,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(`Replay status: ${result.status}`);
    if (result.status === "success") {
      console.log("Outputs:");
      console.log(JSON.stringify(result.outputs, null, 2));
    } else if (result.status === "business_outcome") {
      console.log(`${result.code}: ${result.message}`);
    } else if (result.status === "intervention_required") {
      console.log(`Reason: ${result.reason}`);
    } else {
      console.log(`Reason: ${result.message}`);
    }
    console.log(`Evidence JSON: ${evidencePath}`);

    if (result.status === "failure") {
      process.exitCode = 1;
    }
    return result;
  } finally {
    await browser.close();
  }
}
