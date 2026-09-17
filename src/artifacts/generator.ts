import type { AgentLoopResult } from "../discovery/agent-loop.js";
import type { DiscoveryRequest } from "../discovery/request.js";
import type { MemberOutputSpec } from "../targets/bank-demo/member-output-specs.js";
import {
  parseCapabilityArtifact,
  type CapabilityArtifact,
} from "./schema.js";

export function generateMemberLookupArtifact(
  request: DiscoveryRequest,
  result: AgentLoopResult,
  outputSpecs: readonly MemberOutputSpec[],
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

  if (outputSpecs.length === 0) {
    throw new Error("At least one validated output is required to generate an artifact.");
  }

  const steps: CapabilityArtifact["steps"] = [];
  for (const step of result.steps) {
    if (step.action.type === "fill") {
      if (step.action.value !== discoveredMemberId) {
        throw new Error(
          `Artifact generation refused a non-parameterized fill value at discovery step ${step.stepNumber}.`,
        );
      }
      const description = parameterizeText(step.action.reason, discoveredMemberId);
      steps.push({
        id: `step_${step.stepNumber}_fill`,
        description,
        action: "fill",
        risk: "safe",
        target: locatorPlan(step.action.target, description),
        value: { source: "input", name: "memberId" },
      });
    }

    if (step.action.type === "click") {
      const description = parameterizeText(step.action.reason, discoveredMemberId);
      steps.push({
        id: `step_${step.stepNumber}_click`,
        description,
        action: "click",
        risk:
          step.action.target.name.toLowerCase() === "search" ? "safe" : "risky",
        target: locatorPlan(step.action.target, description),
      });
    }
  }

  const outputId = outputSpecs.map((spec) => spec.idSegment).join("_and_");
  const outputDescription = outputSpecs.map((spec) => spec.displayName).join(" and ");

  return parseCapabilityArtifact({
    schemaVersion: "1.0",
    capabilityVersion: "1.0.0",
    id: `get_member_${outputId}`,
    name: `Get member ${outputDescription}`,
    description: `Find a member and return the ${outputDescription}.`,
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
    outputs: Object.fromEntries(
      outputSpecs.map((spec) => [spec.outputName, spec.definition]),
    ),
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
        code: "RESTRICTED_RECORD_REVIEW",
        classification: "intervention",
        description: "A human must approve access to the restricted member record.",
        whenTextVisible: "Restricted Record Warning",
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
