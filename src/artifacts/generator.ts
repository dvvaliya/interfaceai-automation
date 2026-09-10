import type { AgentLoopResult } from "../discovery/agent-loop.js";
import type { DiscoveryRequest } from "../discovery/request.js";
import {
  parseCapabilityArtifact,
  type CapabilityArtifact,
} from "./schema.js";

export function generateMemberBalanceArtifact(
  request: DiscoveryRequest,
  result: AgentLoopResult,
): CapabilityArtifact {
  if (result.status !== "completed") {
    throw new Error("A capability artifact can only be generated from a completed discovery run.");
  }

  const memberId = result.steps.find(
    (step) =>
      step.action.type === "fill" &&
      step.action.target.role === "textbox" &&
      step.action.target.name === "Member Number" &&
      /^\d{5}$/.test(step.action.value),
  )?.action;

  if (!memberId || memberId.type !== "fill") {
    throw new Error("Could not infer a five-digit memberId from the successful discovery actions.");
  }

  const discoveredMemberId = memberId.value;

  const savingsBalance = result.outputs.savingsBalance;
  if (!savingsBalance) {
    throw new Error("The completed discovery run did not return 'savingsBalance'.");
  }

  const steps: CapabilityArtifact["steps"] = [];
  for (const step of result.steps) {
    if (step.action.type === "fill") {
      const description = parameterizeText(step.action.reason, discoveredMemberId);
      steps.push({
        id: `step_${step.stepNumber}_fill`,
        description,
        action: "fill",
        risk: "safe",
        target: locatorPlan(step.action.target, description),
        value:
          step.action.value === discoveredMemberId
            ? { source: "input", name: "memberId" }
            : { source: "literal", value: step.action.value },
      });
    }

    if (step.action.type === "click") {
      const description = parameterizeText(step.action.reason, discoveredMemberId);
      steps.push({
        id: `step_${step.stepNumber}_click`,
        description,
        action: "click",
        risk: "safe",
        target: locatorPlan(step.action.target, description),
      });
    }
  }

  return parseCapabilityArtifact({
    schemaVersion: "1.0",
    capabilityVersion: "1.0.0",
    id: "get_member_savings_balance",
    name: "Get member savings balance",
    description: "Find a member and return the available Regular Savings balance.",
    status: "draft",
    surface: {
      type: "web",
      appId: "meridian_core",
      entryUrl: request.target,
      allowedOrigins: [new URL(request.target).origin],
    },
    inputs: {
      memberId: {
        type: "string",
        description: "Five-digit member identifier.",
        required: true,
        sensitive: true,
        pattern: "^[0-9]{5}$",
      },
    },
    steps,
    outputs: {
      savingsBalance: {
        type: "string",
        description: "Available balance of the Regular Savings account.",
        required: true,
        source: {
          kind: "table_cell",
          table: {
            primary: { strategy: "role", role: "region", name: "Deposit Accounts" },
            fallbacks: [],
            rationale: "The named account region is stable and independent of member data.",
          },
          rowMatch: { column: "Type", value: "Regular Savings" },
          column: "Available Balance",
        },
      },
    },
    checkpoint: {
      kind: "visible",
      target: {
        primary: { strategy: "role", role: "heading", name: "Member Profile" },
        fallbacks: [],
        rationale: "The profile heading confirms that member lookup reached the detail page.",
      },
    },
    knownOutcomes: [
      {
        code: "MEMBER_NOT_FOUND",
        classification: "business",
        description: "No member exists for the supplied identifier.",
        whenTextVisible: "No Member Found",
      },
      {
        code: "PERMISSION_DENIED",
        classification: "failure",
        description: "The operator cannot access the requested member.",
        whenTextVisible: "Access Denied",
      },
      {
        code: "SESSION_EXPIRED",
        classification: "recoverable",
        description: "The authenticated session expired during replay.",
        whenTextVisible: "Session Expired",
      },
      {
        code: "APPLICATION_ERROR",
        classification: "failure",
        description: "The target application reported an internal error.",
        whenTextVisible: "Application Error",
      },
    ],
  });
}

function locatorPlan(
  target: { strategy: "role"; role: "button" | "link" | "textbox"; name: string },
  rationale: string,
) {
  return {
    primary: { ...target, exact: true },
    fallbacks:
      target.role === "textbox"
        ? [{ strategy: "label" as const, label: target.name, exact: true }]
        : [],
    rationale,
  };
}

function parameterizeText(value: string, memberId: string): string {
  return value.split(memberId).join("{{memberId}}");
}
