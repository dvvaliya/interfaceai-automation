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
const riskyClickReasons = new Map([
  ["create sub-account", "Creating a financial account requires human approval."],
  ["yes, create account", "Confirming financial account creation requires human approval."],
  ["continue and record access", "Accessing a restricted member record requires human approval."],
]);

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

  if (action.type === "escalate" || action.type === "business_outcome" || action.type === "fail") {
    return { effect: "allow", reason: `'${action.type}' is an allowed terminal action.` };
  }

  const locationDecision = evaluateLocationPolicy(policy, context.currentUrl);
  if (locationDecision.effect !== "allow") {
    return locationDecision;
  }

  if (action.type === "fill" && sensitiveTargetName.test(action.target.name)) {
    return {
      effect: "block",
      reason: "The discovery agent may not enter credentials or secrets.",
    };
  }

  const riskyReason =
    action.type === "click" ? riskyClickReasons.get(action.target.name.toLowerCase()) : undefined;
  if (riskyReason) {
    return {
      effect: "require_approval",
      reason: riskyReason,
    };
  }

  return { effect: "allow", reason: "The action is within the configured policy." };
}

export function evaluateOriginPolicy(policy: ActionPolicy, rawUrl: string): PolicyDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { effect: "block", reason: "The target URL is invalid." };
  }

  if (url.protocol === "chrome-error:") {
    return {
      effect: "block",
      reason: "Browser navigation failed and opened an internal error page, likely due to a transient network timeout.",
    };
  }

  if (!policy.allowedOrigins.includes(url.origin)) {
    return { effect: "block", reason: `Origin '${url.origin}' is not allowlisted.` };
  }

  return { effect: "allow", reason: `Origin '${url.origin}' is allowlisted.` };
}

export function evaluateLocationPolicy(policy: ActionPolicy, rawUrl: string): PolicyDecision {
  const originDecision = evaluateOriginPolicy(policy, rawUrl);
  if (originDecision.effect !== "allow") {
    return originDecision;
  }

  const url = new URL(rawUrl);
  if (!policy.allowedPathPrefixes.some((prefix) => pathMatches(url.pathname, prefix))) {
    return { effect: "block", reason: `Path '${url.pathname}' is not allowlisted.` };
  }

  return { effect: "allow", reason: "The current surface location is allowlisted." };
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
