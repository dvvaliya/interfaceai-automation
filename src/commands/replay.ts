import path from "node:path";
import { chromium } from "playwright";
import { loadCapabilityArtifact } from "../artifacts/loader.js";
import type { AppConfig } from "../config/env.js";
import { HandoffController } from "../handoff/controller.js";
import { installHumanActionCapture } from "../handoff/instrumentation.js";
import { runOperatorHandoff } from "../handoff/operator-cli.js";
import { saveIntervention } from "../handoff/store.js";
import { RunEvidence } from "../observability/run-evidence.js";
import { installBrowserRequestGuard } from "../policy/browser-request-guard.js";
import {
  assertPolicyAllows,
  createActionPolicy,
  evaluateLocationPolicy,
} from "../policy/action-policy.js";
import {
  executeReplay,
  type ReplayExecutionEvent,
  type ReplayResult,
} from "../replay/executor.js";
import { resolveReplayInputs, type ReplayInputs } from "../replay/inputs.js";
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
  const assignmentValues = inputAssignments.map((assignment) => {
    const separatorIndex = assignment.indexOf("=");
    return separatorIndex >= 0 ? assignment.slice(separatorIndex + 1) : assignment;
  });
  const runEvidence = await RunEvidence.create("replay", {
    redactionValues: assignmentValues,
  });
  let inputs: ReplayInputs;
  try {
    inputs = resolveReplayInputs(artifact.inputs, inputAssignments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid replay input.";
    const result: ReplayResult = {
      status: "failure",
      category: "hard",
      code: "INVALID_INPUT",
      message,
      expected: "All required artifact inputs must use key=value and satisfy their schemas.",
      observed: inputAssignments.length > 0 ? "Invalid input assignment supplied." : "No input supplied.",
      steps: [],
    };
    runEvidence.record("run_rejected", { code: result.code, message });
    await runEvidence.writeJson("result.json", {
      capability: artifact.id,
      capabilityVersion: artifact.capabilityVersion,
      inputs: "[REDACTED]",
      result,
    });
    await runEvidence.flush();
    console.log("\n=== FINAL RESULT ===");
    console.log("Status: failure");
    console.log(`INVALID_INPUT: ${message}`);
    process.exitCode = 1;
    return result;
  }
  const steps = resolveReplaySteps(artifact, inputs);
  const sensitiveValues = Object.entries(inputs)
    .filter(([name]) => artifact.inputs[name]?.sensitive)
    .map(([, value]) => String(value));
  runEvidence.addRedactionValues(sensitiveValues);
  runEvidence.record("run_started", {
    capability: artifact.id,
    capabilityVersion: artifact.capabilityVersion,
    inputs,
  });
  const entryOrigin = new URL(artifact.surface.entryUrl).origin;

  if (!artifact.surface.allowedOrigins.includes(entryOrigin)) {
    throw new Error(`Artifact entry origin '${entryOrigin}' is not allowed by the artifact.`);
  }
  if (!config.BANK_OPERATOR_ID || !config.BANK_OPERATOR_PASSWORD) {
    throw new Error("Bank operator credentials must be configured for replay.");
  }

  const policy = createActionPolicy(config);
  assertPolicyAllows(evaluateLocationPolicy(policy, artifact.surface.entryUrl));

  const handoffEnabled = !headless;
  const browser = await chromium.launch({ headless });
  try {
    let activeController: HandoffController | undefined;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await installBrowserRequestGuard(
      context,
      {
        allowedOrigins: policy.allowedOrigins.filter((origin) =>
          artifact.surface.allowedOrigins.includes(origin),
        ),
        allowedPathPrefixes: policy.allowedPathPrefixes,
      },
      (url) => runEvidence.record("browser_request_blocked", { url }),
    );
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

    runEvidence.record("authenticated", { url: page.url() });
    const surface = new PlaywrightSurface(page, runEvidence.screenshotsDirectory);
    const recordReplayEvent = (event: ReplayExecutionEvent) =>
      runEvidence.record(event.type, event.data);
    let result = await executeReplay({
      artifact,
      steps,
      surface,
      policy,
      onEvent: recordReplayEvent,
    });

    if (result.status === "failure" && result.category === "recoverable") {
      const recoverableResult = result;
      runEvidence.record("recovery_started", {
        code: result.code,
        strategy: "reauthenticate_and_retry_once",
      });
      try {
        const retryResponse = await page.goto(artifact.surface.entryUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        if (!retryResponse?.ok()) {
          throw new Error(`Entry page returned HTTP ${retryResponse?.status() ?? "unknown"}.`);
        }
        await authenticateBankDemo(page, {
          operatorId: config.BANK_OPERATOR_ID,
          password: config.BANK_OPERATOR_PASSWORD,
        });
        result = await executeReplay({
          artifact,
          steps,
          surface,
          policy,
          onEvent: recordReplayEvent,
          evidencePrefix: "replay-retry-1",
        });
        runEvidence.record("recovery_finished", { status: result.status });
      } catch (error) {
        const recoveryError =
          error instanceof Error ? error.message : "Unknown recovery error.";
        runEvidence.record("recovery_failed", {
          reason: recoveryError,
        });
        result = {
          ...recoverableResult,
          message: `${recoverableResult.message} Recovery attempt failed: ${recoveryError}`,
        };
      }
    }
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
        expectedHumanAction: result.expectedHumanAction,
        timeoutMs: config.HANDOFF_TIMEOUT_MS,
        maxResumeAttempts: config.HANDOFF_MAX_RESUME_ATTEMPTS,
        evidenceDirectory: path.join(runEvidence.directory, "handoff"),
        redactionValues: sensitiveValues,
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
        startStepIndex:
          operatorDecision === "complete" ? steps.length : result.resumeAtStepIndex,
        previousSteps: result.steps,
        onEvent: recordReplayEvent,
        evidencePrefix: `replay-resume-${interventionCount}`,
      });

      if (result.status === "success" || result.status === "business_outcome") {
        controller.complete();
      } else if (result.status === "failure") {
        controller.abort();
      }
      await saveIntervention(
        controller.snapshot(),
        path.join(runEvidence.directory, "handoff"),
        sensitiveValues,
      );
      activeController = undefined;
    }

    const redactedInputs = Object.fromEntries(
      Object.entries(inputs).map(([name, value]) => [
        name,
        artifact.inputs[name]?.sensitive ? "[REDACTED]" : value,
      ]),
    );
    if (result.status === "success") {
      runEvidence.addRedactionValues(Object.values(result.outputs));
    }
    runEvidence.record("run_finished", { status: result.status, stepCount: result.steps.length });
    await runEvidence.writeJson("result.json", {
      capability: artifact.id,
      capabilityVersion: artifact.capabilityVersion,
      inputs: redactedInputs,
      result,
    });

    console.log(`\nSteps executed: ${result.steps.length}`);
    console.log(`Evidence: ${runEvidence.directory}`);
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
    if (result.status === "intervention_required" && !handoffEnabled) process.exitCode = 2;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown replay error.";
    runEvidence.record("run_failed", { message });
    await runEvidence.writeJson("failure.json", { status: "failure", message });
    throw error;
  } finally {
    await runEvidence.flush();
    await browser.close();
  }
}
