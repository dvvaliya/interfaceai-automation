import type { AgentAction } from "../actions/schema.js";
import type { AppConfig } from "../config/env.js";

export type PolicyDecision =
  | { effect: "allow"; reason: string }
  | { effect: "block"; reason: string }
  | { effect: "require_approval"; reason: string };

export type PolicyContext = {
  currentUrl: string;
};

export type ActionPolicy = {
  allowedOrigins: readonly string[];
  allowedPathPrefixes: readonly string[];
  allowedActionTypes: readonly AgentAction["type"][];
};

const sensitiveTargetName = /(password|passcode|pin|token|secret|social security|ssn)/i;
const riskyClickNames = new Set(["create sub-account", "yes, create account"]);

export function createActionPolicy(config: AppConfig): ActionPolicy {
  return {
    allowedOrigins: config.ALLOWED_ORIGINS,
    allowedPathPrefixes: config.ALLOWED_PATH_PREFIXES,
    allowedActionTypes: config.ALLOWED_ACTIONS,
  };
}

export function evaluateActionPolicy(
  policy: ActionPolicy,
  action: AgentAction,
  context: PolicyContext,
): PolicyDecision {
  if (!policy.allowedActionTypes.includes(action.type)) {
    return { effect: "block", reason: `Action type '${action.type}' is not allowlisted.` };
  }

  if (action.type === "escalate") {
    return { effect: "allow", reason: "Escalation is an allowed safe terminal action." };
  }

  let url: URL;
  try {
    url = new URL(context.currentUrl);
  } catch {
    return { effect: "block", reason: "The current surface URL is invalid." };
  }

  if (!policy.allowedOrigins.includes(url.origin)) {
    return { effect: "block", reason: `Origin '${url.origin}' is not allowlisted.` };
  }

  if (!policy.allowedPathPrefixes.some((prefix) => pathMatches(url.pathname, prefix))) {
    return { effect: "block", reason: `Path '${url.pathname}' is not allowlisted.` };
  }

  if (action.type === "fill" && sensitiveTargetName.test(action.target.name)) {
    return {
      effect: "block",
      reason: "The discovery agent may not enter credentials or secrets.",
    };
  }

  if (action.type === "click" && riskyClickNames.has(action.target.name.toLowerCase())) {
    return {
      effect: "require_approval",
      reason: `Clicking '${action.target.name}' may create a financial account.`,
    };
  }

  return { effect: "allow", reason: "The action is within the configured policy." };
}

export function assertPolicyAllows(decision: PolicyDecision): void {
  if (decision.effect === "block") {
    throw new PolicyBlockedError(decision.reason);
  }

  if (decision.effect === "require_approval") {
    throw new ApprovalRequiredError(decision.reason);
  }
}

export class PolicyBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyBlockedError";
  }
}

export class ApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

function pathMatches(pathname: string, allowedPrefix: string): boolean {
  if (allowedPrefix === "/") {
    return true;
  }

  return pathname === allowedPrefix || pathname.startsWith(`${allowedPrefix}/`);
}
