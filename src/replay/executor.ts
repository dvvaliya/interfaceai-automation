import type { CapabilityArtifact } from "../artifacts/schema.js";
import type { AgentAction } from "../actions/schema.js";
import {
  evaluateActionPolicy,
  evaluateLocationPolicy,
  type ActionPolicy,
} from "../policy/action-policy.js";
import type { ComputerSurface, SurfaceObservation, SurfaceTarget } from "../surface/types.js";
import type { ResolvedReplayStep } from "./plan.js";

type LocatorPlan = CapabilityArtifact["steps"][number]["target"];

export type ReplayStepRecord = {
  stepId: string;
  description: string;
  action: "fill" | "click";
  risk: "safe" | "reversible" | "risky";
  status: "success";
  locatorStrategy: SurfaceTarget["strategy"];
  durationMs: number;
  expected: string;
  observed: string;
  evidence: SurfaceObservation;
};

export type ReplayExecutionEvent = {
  type:
    | "replay_step_started"
    | "replay_policy_evaluated"
    | "replay_step_completed"
    | "replay_outcome_detected"
    | "replay_checkpoint_evaluated"
    | "replay_outputs_extracted";
  data: Record<string, unknown>;
};

export type ReplayResult =
  | { status: "success"; outputs: Record<string, string | number | boolean>; steps: ReplayStepRecord[] }
  | {
      status: "business_outcome";
      code: string;
      message: string;
      stepId: string;
      evidence: SurfaceObservation;
      steps: ReplayStepRecord[];
    }
  | {
      status: "intervention_required";
      reason: string;
      stepId: string;
      blockerText?: string;
      cancelledText?: string;
      expectedHumanAction?: { type: "click"; name: string };
      resumeAtStepIndex: number;
      evidence: SurfaceObservation;
      expected?: string;
      observed?: string;
      attemptedLocators?: SurfaceTarget[];
      steps: ReplayStepRecord[];
    }
  | {
      status: "failure";
      category: "recoverable" | "hard";
      code: string;
      message: string;
      stepId?: string;
      evidence?: SurfaceObservation;
      expected?: string;
      observed?: string;
      attemptedLocators?: SurfaceTarget[];
      steps: ReplayStepRecord[];
    };

export async function executeReplay(options: {
  artifact: CapabilityArtifact;
  steps: ResolvedReplayStep[];
  surface: ComputerSurface;
  policy: ActionPolicy;
  startStepIndex?: number;
  previousSteps?: ReplayStepRecord[];
  onEvent?: (event: ReplayExecutionEvent) => void;
  evidencePrefix?: string;
}): Promise<ReplayResult> {
  const records: ReplayStepRecord[] = [...(options.previousSteps ?? [])];
  const startStepIndex = options.startStepIndex ?? 0;
  const evidencePrefix = options.evidencePrefix ?? "replay";
  let currentStepId: string | undefined;
  let currentStepIndex = startStepIndex;

  try {
    for (let index = startStepIndex; index < options.steps.length; index += 1) {
      const step = options.steps[index]!;
      currentStepId = step.id;
      currentStepIndex = index;
      const stepStartedAt = Date.now();
      const expected = `${step.action} '${targetNameFromPlan(step.target)}'`;
      options.onEvent?.({
        type: "replay_step_started",
        data: {
          stepId: step.id,
          description: step.description,
          action: step.action,
          risk: step.risk,
          expected,
        },
      });

      const beforeEvidence = await options.surface.observe(
        `${evidencePrefix}-step-${index}-before`,
      );
      const artifactLocationError = validateArtifactLocation(options.artifact, beforeEvidence.url);
      if (artifactLocationError) {
        return failure("hard", "ARTIFACT_ORIGIN_BLOCKED", artifactLocationError, records, step.id, {
          evidence: beforeEvidence,
          expected,
          observed: beforeEvidence.url,
          attemptedLocators: locatorCandidates(step.target),
        });
      }
      const locationDecision = evaluateLocationPolicy(options.policy, beforeEvidence.url);
      if (locationDecision.effect !== "allow") {
        return failure("hard", "POLICY_BLOCKED", locationDecision.reason, records, step.id, {
          evidence: beforeEvidence,
          expected,
          observed: beforeEvidence.url,
          attemptedLocators: locatorCandidates(step.target),
        });
      }

      const semanticAction = replayStepToPolicyAction(step);
      const actionDecision = evaluateActionPolicy(options.policy, semanticAction, {
        currentUrl: beforeEvidence.url,
      });
      options.onEvent?.({
        type: "replay_policy_evaluated",
        data: { stepId: step.id, ...actionDecision },
      });
      if (actionDecision.effect === "block") {
        return failure("hard", "ACTION_NOT_ALLOWED", actionDecision.reason, records, step.id, {
          evidence: beforeEvidence,
          expected,
          observed: actionDecision.reason,
          attemptedLocators: locatorCandidates(step.target),
        });
      }

      if (step.risk === "risky" || actionDecision.effect === "require_approval") {
        const targetName = targetNameFromPlan(step.target);
        return {
          status: "intervention_required",
          reason:
            actionDecision.effect === "require_approval"
              ? actionDecision.reason
              : `Step '${step.id}' is marked risky and requires human approval.`,
          stepId: step.id,
          expectedHumanAction: { type: "click", name: targetName },
          resumeAtStepIndex: index + 1,
          evidence: beforeEvidence,
          steps: records,
        };
      }

      const locator = await executeStepWithFallback(options.surface, step);
      const evidence = await options.surface.observe(
        `${evidencePrefix}-step-${index + 1}-after`,
      );
      const postActionArtifactError = validateArtifactLocation(options.artifact, evidence.url);
      if (postActionArtifactError) {
        return failure(
          "hard",
          "ARTIFACT_ORIGIN_BLOCKED",
          postActionArtifactError,
          records,
          step.id,
          {
            evidence,
            expected,
            observed: evidence.url,
            attemptedLocators: locatorCandidates(step.target),
          },
        );
      }
      records.push({
        stepId: step.id,
        description: step.description,
        action: step.action,
        risk: step.risk,
        status: "success",
        locatorStrategy: locator.strategy,
        durationMs: Date.now() - stepStartedAt,
        expected,
        observed: evidence.url,
        evidence,
      });
      options.onEvent?.({
        type: "replay_step_completed",
        data: {
          stepId: step.id,
          locatorStrategy: locator.strategy,
          durationMs: Date.now() - stepStartedAt,
          observedUrl: evidence.url,
          screenshotPath: evidence.screenshotPath,
        },
      });

      const knownOutcome = await detectKnownOutcome(
        options.artifact,
        options.surface,
        step.id,
        index + 1,
        evidence,
        records,
      );
      if (knownOutcome) {
        options.onEvent?.({
          type: "replay_outcome_detected",
          data: {
            stepId: step.id,
            status: knownOutcome.status,
            code: "code" in knownOutcome ? knownOutcome.code : undefined,
          },
        });
        return knownOutcome;
      }
    }

    const finalObservation = await options.surface.observe(`${evidencePrefix}-final`);
    const finalArtifactError = validateArtifactLocation(options.artifact, finalObservation.url);
    if (finalArtifactError) {
      return {
        status: "failure",
        category: "hard",
        code: "ARTIFACT_ORIGIN_BLOCKED",
        message: finalArtifactError,
        stepId: currentStepId,
        evidence: finalObservation,
        steps: records,
      };
    }
    const checkpointPassed = await verifyCheckpoint(
      options.artifact.checkpoint,
      options.surface,
      finalObservation,
    );
    options.onEvent?.({
      type: "replay_checkpoint_evaluated",
      data: {
        passed: checkpointPassed,
        checkpoint: options.artifact.checkpoint,
        observedUrl: finalObservation.url,
        screenshotPath: finalObservation.screenshotPath,
      },
    });
    if (!checkpointPassed) {
      return {
        status: "intervention_required",
        reason: "Replay steps finished, but the success checkpoint was not satisfied.",
        stepId: currentStepId ?? "checkpoint",
        resumeAtStepIndex: options.steps.length,
        evidence: finalObservation,
        steps: records,
      };
    }

    const outputs = await extractOutputs(options.artifact, options.surface);
    options.onEvent?.({
      type: "replay_outputs_extracted",
      data: { outputNames: Object.keys(outputs) },
    });
    return { status: "success", outputs, steps: records };
  } catch (error) {
    let evidence: SurfaceObservation | undefined;
    try {
      evidence = await options.surface.observe(`${evidencePrefix}-failure`);
    } catch {
      // Preserve the original failure if evidence capture also fails.
    }

    if (evidence && currentStepId) {
      return {
        status: "intervention_required",
        reason: error instanceof Error ? error.message : "Unknown replay error.",
        stepId: currentStepId,
        resumeAtStepIndex: currentStepIndex,
        evidence,
        expected: currentStepId ? `Complete replay step '${currentStepId}'.` : undefined,
        observed: `${evidence.url}: ${evidence.accessibilitySnapshot.slice(0, 500)}`,
        attemptedLocators:
          currentStepIndex < options.steps.length
            ? locatorCandidates(options.steps[currentStepIndex]!.target)
            : undefined,
        steps: records,
      };
    }

    return failure(
      "hard",
      "STEP_EXECUTION_FAILED",
      error instanceof Error ? error.message : "Unknown replay error.",
      records,
      currentStepId,
    );
  }
}

async function executeStepWithFallback(
  surface: ComputerSurface,
  step: ResolvedReplayStep,
): Promise<SurfaceTarget> {
  const candidates = locatorCandidates(step.target);
  let lastError: unknown;

  for (const target of candidates) {
    try {
      if (step.action === "fill") {
        await surface.fill(target, step.value);
      } else {
        await surface.click(target);
      }
      return target;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "No locator matched.";
  throw new Error(`Step '${step.id}' failed for all locator strategies: ${message}`);
}

async function detectKnownOutcome(
  artifact: CapabilityArtifact,
  surface: ComputerSurface,
  stepId: string,
  resumeAtStepIndex: number,
  evidence: SurfaceObservation,
  steps: ReplayStepRecord[],
): Promise<ReplayResult | undefined> {
  for (const outcome of artifact.knownOutcomes) {
    const visible = await surface.isVisible(
      { strategy: "text", text: outcome.whenTextVisible, exact: true },
      300,
    );
    if (!visible) continue;

    if (outcome.classification === "business") {
      return {
        status: "business_outcome",
        code: outcome.code,
        message: outcome.description,
        stepId,
        evidence,
        steps,
      };
    }

    if (outcome.classification === "intervention") {
      return {
        status: "intervention_required",
        reason: outcome.description,
        stepId,
        blockerText: outcome.whenTextVisible,
        cancelledText:
          outcome.code === "RESTRICTED_RECORD_REVIEW"
            ? "Record access was cancelled. No member information was displayed."
            : undefined,
        expectedHumanAction:
          outcome.code === "RESTRICTED_RECORD_REVIEW"
            ? { type: "click", name: "Continue and record access" }
            : undefined,
        resumeAtStepIndex,
        evidence,
        steps,
      };
    }

    return {
      status: "failure",
      category: outcome.classification === "recoverable" ? "recoverable" : "hard",
      code: outcome.code,
      message: outcome.description,
      stepId,
      evidence,
      expected: "Continue without a declared failure outcome.",
      observed: outcome.whenTextVisible,
      steps,
    };
  }

  return undefined;
}

async function verifyCheckpoint(
  checkpoint: CapabilityArtifact["checkpoint"],
  surface: ComputerSurface,
  observation: SurfaceObservation,
): Promise<boolean> {
  if (checkpoint.kind === "url_matches") {
    return new RegExp(checkpoint.pattern).test(observation.url);
  }

  return isAnyLocatorVisible(surface, checkpoint.target);
}

async function extractOutputs(
  artifact: CapabilityArtifact,
  surface: ComputerSurface,
): Promise<Record<string, string | number | boolean>> {
  const outputs: Record<string, string | number | boolean> = {};

  for (const [name, definition] of Object.entries(artifact.outputs)) {
    const source = definition.source;
    let rawValue: string;
    if (source.kind === "text") {
      rawValue = await withLocatorFallback(source.target, (target) =>
        surface.extractText(target),
      );
    } else {
      rawValue = await withLocatorFallback(source.table, (target) =>
        surface.extractTableCell(target, source.rowMatch, source.column),
      );
    }

    outputs[name] = convertOutput(name, definition.type, rawValue);
  }

  return outputs;
}

async function isAnyLocatorVisible(
  surface: ComputerSurface,
  plan: LocatorPlan,
): Promise<boolean> {
  for (const target of locatorCandidates(plan)) {
    if (await surface.isVisible(target, 1_000)) return true;
  }
  return false;
}

async function withLocatorFallback<T>(
  plan: LocatorPlan,
  operation: (target: SurfaceTarget) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const target of locatorCandidates(plan)) {
    try {
      return await operation(target);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No locator matched.");
}

function locatorCandidates(plan: LocatorPlan): SurfaceTarget[] {
  return [plan.primary, ...plan.fallbacks];
}

function replayStepToPolicyAction(step: ResolvedReplayStep): AgentAction {
  const name = targetNameFromPlan(step.target);
  if (step.action === "fill") {
    return {
      type: "fill",
      target: { strategy: "role", role: "textbox", name },
      value: step.value,
      reason: step.description,
    };
  }

  return {
    type: "click",
    target: { strategy: "role", role: "button", name },
    reason: step.description,
  };
}

function targetNameFromPlan(plan: LocatorPlan): string {
  const primary = plan.primary;
  if (primary.strategy === "role") return primary.name;
  if (primary.strategy === "label") return primary.label;
  return primary.text;
}

function validateArtifactLocation(
  artifact: CapabilityArtifact,
  rawUrl: string,
): string | undefined {
  let origin: string;
  try {
    origin = new URL(rawUrl).origin;
  } catch {
    return `Replay reached an invalid URL '${rawUrl}'.`;
  }

  if (!artifact.surface.allowedOrigins.includes(origin)) {
    return `Origin '${origin}' is not authorized by capability '${artifact.id}'.`;
  }
  return undefined;
}

function convertOutput(
  name: string,
  type: "string" | "number" | "boolean",
  rawValue: string,
): string | number | boolean {
  if (type === "string") return rawValue;
  if (type === "number") {
    const value = Number(rawValue.replace(/[$,]/g, ""));
    if (!Number.isFinite(value)) throw new Error(`Output '${name}' is not a number.`);
    return value;
  }
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  throw new Error(`Output '${name}' is not a boolean.`);
}

function failure(
  category: "recoverable" | "hard",
  code: string,
  message: string,
  steps: ReplayStepRecord[],
  stepId?: string,
  diagnostics: {
    evidence?: SurfaceObservation;
    expected?: string;
    observed?: string;
    attemptedLocators?: SurfaceTarget[];
  } = {},
): ReplayResult {
  return { status: "failure", category, code, message, stepId, ...diagnostics, steps };
}
