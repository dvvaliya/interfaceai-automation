import type { CapabilityArtifact } from "../artifacts/schema.js";
import {
  evaluateLocationPolicy,
  type ActionPolicy,
} from "../policy/action-policy.js";
import type { ComputerSurface, SurfaceObservation, SurfaceTarget } from "../surface/types.js";
import type { ResolvedReplayStep } from "./plan.js";

type LocatorPlan = CapabilityArtifact["steps"][number]["target"];

export type ReplayStepRecord = {
  stepId: string;
  action: "fill" | "click";
  status: "success";
  locatorStrategy: SurfaceTarget["strategy"];
  evidence: SurfaceObservation;
};

export type ReplayResult =
  | { status: "success"; outputs: Record<string, string | number | boolean>; steps: ReplayStepRecord[] }
  | { status: "business_outcome"; code: string; message: string; stepId: string; steps: ReplayStepRecord[] }
  | { status: "intervention_required"; reason: string; stepId: string; steps: ReplayStepRecord[] }
  | {
      status: "failure";
      category: "recoverable" | "hard";
      code: string;
      message: string;
      stepId?: string;
      evidence?: SurfaceObservation;
      steps: ReplayStepRecord[];
    };

export async function executeReplay(options: {
  artifact: CapabilityArtifact;
  steps: ResolvedReplayStep[];
  surface: ComputerSurface;
  policy: ActionPolicy;
}): Promise<ReplayResult> {
  const records: ReplayStepRecord[] = [];
  let currentStepId: string | undefined;

  try {
    for (let index = 0; index < options.steps.length; index += 1) {
      const step = options.steps[index]!;
      currentStepId = step.id;

      const locationDecision = evaluateLocationPolicy(
        options.policy,
        (await options.surface.observe(`replay-step-${index}-before`)).url,
      );
      if (locationDecision.effect !== "allow") {
        return failure("hard", "POLICY_BLOCKED", locationDecision.reason, records, step.id);
      }

      if (!options.policy.allowedActionTypes.includes(step.action)) {
        return failure(
          "hard",
          "ACTION_NOT_ALLOWED",
          `Action '${step.action}' is not allowlisted.`,
          records,
          step.id,
        );
      }

      if (step.risk === "risky") {
        return {
          status: "intervention_required",
          reason: `Step '${step.id}' is marked risky and requires human approval.`,
          stepId: step.id,
          steps: records,
        };
      }

      const locator = await executeStepWithFallback(options.surface, step);
      const evidence = await options.surface.observe(`replay-step-${index + 1}-after`);
      records.push({
        stepId: step.id,
        action: step.action,
        status: "success",
        locatorStrategy: locator.strategy,
        evidence,
      });

      const knownOutcome = await detectKnownOutcome(options.artifact, options.surface, step.id, records);
      if (knownOutcome) {
        return knownOutcome;
      }
    }

    const finalObservation = await options.surface.observe("replay-final");
    const checkpointPassed = await verifyCheckpoint(
      options.artifact.checkpoint,
      options.surface,
      finalObservation,
    );
    if (!checkpointPassed) {
      return {
        status: "failure",
        category: "hard",
        code: "CHECKPOINT_FAILED",
        message: "Replay steps finished, but the declared success checkpoint was not satisfied.",
        stepId: currentStepId,
        evidence: finalObservation,
        steps: records,
      };
    }

    const outputs = await extractOutputs(options.artifact, options.surface);
    return { status: "success", outputs, steps: records };
  } catch (error) {
    let evidence: SurfaceObservation | undefined;
    try {
      evidence = await options.surface.observe("replay-failure");
    } catch {
      // Preserve the original failure if evidence capture also fails.
    }

    return {
      status: "failure",
      category: "hard",
      code: "STEP_EXECUTION_FAILED",
      message: error instanceof Error ? error.message : "Unknown replay error.",
      stepId: currentStepId,
      evidence,
      steps: records,
    };
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
        steps,
      };
    }

    return {
      status: "failure",
      category: outcome.classification === "recoverable" ? "recoverable" : "hard",
      code: outcome.code,
      message: outcome.description,
      stepId,
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
): ReplayResult {
  return { status: "failure", category, code, message, stepId, steps };
}
