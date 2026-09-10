import { executeAction, type ExecutionOutcome } from "../actions/executor.js";
import { parseAgentAction, type AgentAction } from "../actions/schema.js";
import type { LlmProvider } from "../llm/provider.js";
import {
  evaluateActionPolicy,
  evaluateLocationPolicy,
  type ActionPolicy,
  type PolicyDecision,
} from "../policy/action-policy.js";
import type { ComputerSurface, SurfaceObservation } from "../surface/types.js";

export type AgentStepRecord = {
  stepNumber: number;
  observation: SurfaceObservation;
  action: AgentAction;
  policyDecision: PolicyDecision;
  executionOutcome?: ExecutionOutcome;
  executionWarning?: string;
  nextObservation?: SurfaceObservation;
};

type AgentLoopBaseResult = {
  steps: AgentStepRecord[];
};

export type AgentLoopResult =
  | (AgentLoopBaseResult & {
      status: "completed";
      summary: string;
      outputs: Record<string, string>;
    })
  | (AgentLoopBaseResult & {
      status: "escalated";
      reason: string;
    })
  | (AgentLoopBaseResult & {
      status: "business_outcome";
      code: string;
      message: string;
    })
  | (AgentLoopBaseResult & {
      status: "failed";
      reason: string;
      failedStep: number;
      category?: "recoverable" | "hard";
      code?: string;
    });

export type AgentLoopOptions = {
  goal: string;
  provider: LlmProvider;
  surface: ComputerSurface;
  policy: ActionPolicy;
  maxSteps: number;
  timeoutMs: number;
  maxRepeatedActions?: number;
  evidencePrefix?: string;
  initialActionHistory?: readonly AgentAction[];
  stepNumberOffset?: number;
  onProgress?: (message: string) => void;
};

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const startedAt = Date.now();
  const steps: AgentStepRecord[] = [];
  const actionHistory: AgentAction[] = [...(options.initialActionHistory ?? [])];
  const maxRepeatedActions = options.maxRepeatedActions ?? 2;
  const evidencePrefix = options.evidencePrefix ?? "discovery";
  const stepNumberOffset = options.stepNumberOffset ?? 0;
  let previousActionSignature: string | undefined;
  let repeatedActionCount = 0;
  let observation: SurfaceObservation;

  try {
    options.onProgress?.("[browser] Capturing the current page state...");
    observation = await options.surface.observe(`${evidencePrefix}-step-0`);
  } catch (error) {
    return failedResult(steps, 0, error);
  }

  for (let iteration = 1; iteration <= options.maxSteps; iteration += 1) {
    const stepNumber = stepNumberOffset + iteration;
    if (Date.now() - startedAt >= options.timeoutMs) {
      return {
        status: "failed",
        reason: `Discovery exceeded the ${options.timeoutMs}ms timeout.`,
        failedStep: stepNumber,
        steps,
      };
    }

    try {
      const locationDecision = evaluateLocationPolicy(options.policy, observation.url);
      if (locationDecision.effect !== "allow") {
        return {
          status: "failed",
          reason: locationDecision.reason,
          failedStep: stepNumber,
          steps,
        };
      }

      options.onProgress?.(
        `[llm] Step ${stepNumber}: requesting the next action from ${options.provider.name}...`,
      );
      const requestStartedAt = Date.now();
      const rawAction = await options.provider.decideNextAction({
        goal: options.goal,
        observation,
        stepNumber,
        actionHistory: [...actionHistory],
      });
      options.onProgress?.(
        `[llm] Step ${stepNumber}: response received in ${Date.now() - requestStartedAt}ms.`,
      );
      const action = parseAgentAction(rawAction);
      options.onProgress?.(
        `[agent] Step ${stepNumber}: validated ${describeAction(action)}.`,
      );
      const actionSignature = JSON.stringify(action);

      if (actionSignature === previousActionSignature) {
        repeatedActionCount += 1;
      } else {
        previousActionSignature = actionSignature;
        repeatedActionCount = 1;
      }

      if (repeatedActionCount > maxRepeatedActions) {
        return {
          status: "failed",
          reason: `The model repeated the same action more than ${maxRepeatedActions} times.`,
          failedStep: stepNumber,
          steps,
        };
      }

      const policyDecision = evaluateActionPolicy(options.policy, action, {
        currentUrl: observation.url,
      });
      const step: AgentStepRecord = {
        stepNumber,
        observation,
        action,
        policyDecision,
      };
      steps.push(step);
      options.onProgress?.(
        `[policy] Step ${stepNumber}: ${policyDecision.effect} - ${policyDecision.reason}`,
      );

      if (policyDecision.effect === "block") {
        return {
          status: "failed",
          reason: policyDecision.reason,
          failedStep: stepNumber,
          steps,
        };
      }

      if (policyDecision.effect === "require_approval") {
        return {
          status: "escalated",
          reason: policyDecision.reason,
          steps,
        };
      }

      let executionOutcome: ExecutionOutcome;
      try {
        executionOutcome = await executeAction(options.surface, action);
      } catch (error) {
        const errorObservation = await options.surface.observe(
          `${evidencePrefix}-step-${stepNumber}-error`,
        );
        const pageChanged =
          errorObservation.url !== observation.url ||
          errorObservation.accessibilitySnapshot !== observation.accessibilitySnapshot;

        if (action.type !== "click" || !pageChanged) {
          throw error;
        }

        step.executionWarning =
          error instanceof Error ? error.message : "The click reported an unknown error.";
        step.nextObservation = errorObservation;
        actionHistory.push(action);
        observation = errorObservation;
        continue;
      }
      step.executionOutcome = executionOutcome;
      actionHistory.push(action);
      options.onProgress?.(
        `[agent] Step ${stepNumber}: execution returned '${executionOutcome.status}'.`,
      );

      if (executionOutcome.status === "completed") {
        return {
          status: "completed",
          summary: executionOutcome.summary,
          outputs: executionOutcome.outputs,
          steps,
        };
      }

      if (executionOutcome.status === "escalated") {
        return {
          status: "escalated",
          reason: executionOutcome.reason,
          steps,
        };
      }

      if (executionOutcome.status === "business_outcome") {
        return {
          status: "business_outcome",
          code: executionOutcome.code,
          message: executionOutcome.message,
          steps,
        };
      }

      if (executionOutcome.status === "failed") {
        return {
          status: "failed",
          category: executionOutcome.category,
          code: executionOutcome.code,
          reason: executionOutcome.message,
          failedStep: stepNumber,
          steps,
        };
      }

      observation = await options.surface.observe(`${evidencePrefix}-step-${stepNumber}`);
      step.nextObservation = observation;
    } catch (error) {
      return failedResult(steps, stepNumber, error);
    }
  }

  return {
    status: "failed",
    reason: `Discovery reached the maximum of ${options.maxSteps} steps.`,
    failedStep: stepNumberOffset + options.maxSteps,
    steps,
  };
}

function describeAction(action: AgentAction): string {
  if (action.type === "fill" || action.type === "click") {
    return `'${action.type}' targeting '${action.target.name}'`;
  }
  return `'${action.type}'`;
}

function failedResult(
  steps: AgentStepRecord[],
  failedStep: number,
  error: unknown,
): AgentLoopResult {
  return {
    status: "failed",
    reason: error instanceof Error ? error.message : "Unknown discovery error.",
    failedStep,
    steps,
  };
}
