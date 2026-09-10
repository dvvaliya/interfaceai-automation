import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { generateMemberBalanceArtifact } from "../artifacts/generator.js";
import { saveCapabilityArtifact } from "../artifacts/store.js";
import type { AppConfig } from "../config/env.js";
import { HandoffController } from "../handoff/controller.js";
import { installHumanActionCapture } from "../handoff/instrumentation.js";
import { runOperatorHandoff } from "../handoff/operator-cli.js";
import { saveIntervention } from "../handoff/store.js";
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
  headless = false,
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

  const handoffEnabled = !headless;
  const browser = await chromium.launch({ headless });

  try {
    let activeController: HandoffController | undefined;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await installHumanActionCapture(context, () => activeController);
    const page = await context.newPage();
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
    let result = await runAgentLoop({
      goal: request.goal,
      provider,
      surface,
      policy,
      maxSteps: config.DISCOVERY_MAX_STEPS,
      timeoutMs: config.DISCOVERY_TIMEOUT_MS,
      onProgress: (message) => console.log(message),
    });
    let usedHandoff = false;
    let interventionCount = 0;

    while (result.status === "escalated" && handoffEnabled) {
      usedHandoff = true;
      interventionCount += 1;
      if (interventionCount > 3) {
        result = {
          status: "failed",
          reason: "Discovery exceeded the maximum number of human interventions.",
          failedStep: result.steps.length + 1,
          steps: result.steps,
        };
        break;
      }

      const beforeHandoff = await surface.observe("handoff-before");
      const blockerText = (await surface.isVisible(
        { strategy: "text", text: "Restricted Record Warning", exact: true },
        300,
      ))
        ? "Restricted Record Warning"
        : undefined;
      const controller = new HandoffController({
        capabilityId: "discovery",
        stepId: `discovery-step-${result.steps.length}`,
        reason: result.reason,
        blockerText,
        observation: beforeHandoff,
      });
      activeController = controller;
      const operatorDecision = await runOperatorHandoff({
        controller,
        surface,
        policy,
        blockerText,
        cancelledText: blockerText
          ? "Record access was cancelled. No member information was displayed."
          : undefined,
        timeoutMs: config.HANDOFF_TIMEOUT_MS,
        maxResumeAttempts: config.HANDOFF_MAX_RESUME_ATTEMPTS,
      });

      if (operatorDecision === "abort" || operatorDecision === "timeout") {
        result = {
          status: "failed",
          reason:
            operatorDecision === "timeout"
              ? "Human intervention timed out."
              : "The human operator aborted discovery.",
          failedStep: result.steps.length + 1,
          steps: result.steps,
        };
        activeController = undefined;
        break;
      }

      const previousSteps = result.steps;
      const resumedResult = await runAgentLoop({
        goal: request.goal,
        provider,
        surface,
        policy,
        maxSteps: Math.max(1, config.DISCOVERY_MAX_STEPS - previousSteps.length),
        timeoutMs: config.DISCOVERY_TIMEOUT_MS,
        evidencePrefix: `discovery-resume-${interventionCount}`,
        initialActionHistory: previousSteps.map((step) => step.action),
        stepNumberOffset: previousSteps.length,
        onProgress: (message) => console.log(message),
      });
      result = { ...resumedResult, steps: [...previousSteps, ...resumedResult.steps] };

      if (result.status === "completed") controller.complete();
      if (result.status === "failed") controller.abort();
      await saveIntervention(controller.snapshot());
      activeController = undefined;
    }

    let artifactPath: string | undefined;
    if (result.status === "completed" && !usedHandoff) {
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

    console.log(`\nSteps executed: ${result.steps.length}`);
    console.log(`Evidence: ${evidencePath}`);
    if (artifactPath) {
      console.log(`Artifact: ${artifactPath}`);
    } else if (usedHandoff) {
      console.log("Artifact: not generated because discovery required human intervention.");
    } else if (result.status === "business_outcome") {
      console.log("Artifact: not generated because the goal ended with a business outcome.");
    } else {
      console.log(`Artifact: not generated because discovery ended with status '${result.status}'.`);
    }
    console.log("\n=== FINAL RESULT ===");
    console.log(`Status: ${result.status}`);
    if (result.status === "completed") {
      console.log(`Summary: ${result.summary}`);
      console.log("Outputs:");
      console.log(JSON.stringify(result.outputs, null, 2));
    } else if (result.status === "business_outcome") {
      console.log(`${result.code}: ${result.message}`);
    } else {
      console.log(`Reason: ${result.reason}`);
    }

    if (result.status === "failed") {
      throw new Error(`Discovery failed at step ${result.failedStep}: ${result.reason}`);
    }

    return result;
  } finally {
    await browser.close();
  }
}
