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
      status: "failed";
      reason: string;
      failedStep: number;
    });

export type AgentLoopOptions = {
  goal: string;
  provider: LlmProvider;
  surface: ComputerSurface;
  policy: ActionPolicy;
  maxSteps: number;
  timeoutMs: number;
  maxRepeatedActions?: number;
};

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const startedAt = Date.now();
  const steps: AgentStepRecord[] = [];
  const actionHistory: AgentAction[] = [];
  const maxRepeatedActions = options.maxRepeatedActions ?? 2;
  let previousActionSignature: string | undefined;
  let repeatedActionCount = 0;
  let observation: SurfaceObservation;

  try {
    observation = await options.surface.observe("discovery-step-0");
  } catch (error) {
    return failedResult(steps, 0, error);
  }

  for (let stepNumber = 1; stepNumber <= options.maxSteps; stepNumber += 1) {
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

      const rawAction = await options.provider.decideNextAction({
        goal: options.goal,
        observation,
        stepNumber,
        actionHistory: [...actionHistory],
      });
      const action = parseAgentAction(rawAction);
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

      const executionOutcome = await executeAction(options.surface, action);
      step.executionOutcome = executionOutcome;
      actionHistory.push(action);

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

      observation = await options.surface.observe(`discovery-step-${stepNumber}`);
      step.nextObservation = observation;
    } catch (error) {
      return failedResult(steps, stepNumber, error);
    }
  }

  return {
    status: "failed",
    reason: `Discovery reached the maximum of ${options.maxSteps} steps.`,
    failedStep: options.maxSteps,
    steps,
  };
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
