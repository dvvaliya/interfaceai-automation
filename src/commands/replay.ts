import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { loadCapabilityArtifact } from "../artifacts/loader.js";
import type { AppConfig } from "../config/env.js";
import { HandoffController } from "../handoff/controller.js";
import { installHumanActionCapture } from "../handoff/instrumentation.js";
import { runOperatorHandoff } from "../handoff/operator-cli.js";
import { saveIntervention } from "../handoff/store.js";
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
  headless: boolean,
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

  const handoffEnabled = !headless;
  const browser = await chromium.launch({ headless });
  try {
    let activeController: HandoffController | undefined;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await installHumanActionCapture(context, () => activeController);
    const page = await context.newPage();
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
    let result = await executeReplay({ artifact, steps, surface, policy });
    let interventionCount = 0;

    while (result.status === "intervention_required" && handoffEnabled) {
      interventionCount += 1;
      if (interventionCount > 3) {
        result = {
          status: "failure",
          category: "hard",
          code: "HANDOFF_LIMIT_EXCEEDED",
          message: "Replay exceeded the maximum number of human interventions.",
          stepId: result.stepId,
          evidence: result.evidence,
          steps: result.steps,
        };
        break;
      }

      const handoffObservation = await surface.observe(`handoff-before-${interventionCount}`);
      const controller = new HandoffController({
        capabilityId: artifact.id,
        stepId: result.stepId,
        reason: result.reason,
        blockerText: result.blockerText,
        observation: handoffObservation,
      });
      activeController = controller;
      const operatorDecision = await runOperatorHandoff({
        controller,
        surface,
        policy,
        blockerText: result.blockerText,
        cancelledText: result.cancelledText,
        timeoutMs: config.HANDOFF_TIMEOUT_MS,
        maxResumeAttempts: config.HANDOFF_MAX_RESUME_ATTEMPTS,
      });

      if (operatorDecision === "abort" || operatorDecision === "timeout") {
        result = {
          status: "failure",
          category: "hard",
          code: operatorDecision === "timeout" ? "HANDOFF_TIMEOUT" : "HUMAN_ABORTED",
          message:
            operatorDecision === "timeout"
              ? "Human intervention timed out."
              : "The human operator aborted the replay.",
          stepId: result.stepId,
          evidence: result.evidence,
          steps: result.steps,
        };
        activeController = undefined;
        break;
      }

      result = await executeReplay({
        artifact,
        steps,
        surface,
        policy,
        startStepIndex: result.resumeAtStepIndex,
        previousSteps: result.steps,
      });

      if (result.status === "success" || result.status === "business_outcome") {
        controller.complete();
      } else if (result.status === "failure") {
        controller.abort();
      }
      await saveIntervention(controller.snapshot());
      activeController = undefined;
    }

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

    console.log(`\nSteps executed: ${result.steps.length}`);
    console.log(`Evidence: ${evidencePath}`);
    console.log("\n=== FINAL RESULT ===");
    console.log(`Status: ${result.status}`);
    if (result.status === "success") {
      console.log("Outputs:");
      console.log(JSON.stringify(result.outputs, null, 2));
    } else if (result.status === "business_outcome") {
      console.log(`${result.code}: ${result.message}`);
    } else if (result.status === "intervention_required") {
      console.log(`Reason: ${result.reason}`);
      if (!handoffEnabled) {
        console.log("Headless mode cannot transfer local browser control to a human.");
      }
    } else {
      console.log(`Reason: ${result.message}`);
    }

    if (result.status === "failure") process.exitCode = 1;
    return result;
  } finally {
    await browser.close();
  }
}
