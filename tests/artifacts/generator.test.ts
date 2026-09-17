import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateMemberLookupArtifact } from "../../src/artifacts/generator.js";
import type { AgentLoopResult } from "../../src/discovery/agent-loop.js";
import type { DiscoveryRequest } from "../../src/discovery/request.js";
import type { SurfaceObservation } from "../../src/surface/types.js";
import { resolveMemberOutputSpecs } from "../../src/targets/bank-demo/member-output-specs.js";

const observation: SurfaceObservation = {
  url: "https://interfaceai-bank-demo.vercel.app/members",
  title: "Meridian Core Operations",
  accessibilitySnapshot: 'textbox "Member Number"\nbutton "Search"',
  screenshotPath: "/tmp/discovery.png",
  observedAt: "2026-09-10T00:00:00.000Z",
};

const request: DiscoveryRequest = {
  goal: "Find member 12345 and return the savings balance.",
  target: "https://interfaceai-bank-demo.vercel.app",
};

function completedResult(): AgentLoopResult {
  return {
    status: "completed",
    summary: "The savings balance was found.",
    outputs: { savingsBalance: "$2,450.75" },
    steps: [
      {
        stepNumber: 1,
        observation,
        action: {
          type: "fill",
          target: { strategy: "role", role: "textbox", name: "Member Number" },
          value: "12345",
          reason: "Enter the requested member.",
        },
        policyDecision: { effect: "allow", reason: "Allowed." },
        executionOutcome: { status: "continue" },
        nextObservation: observation,
      },
      {
        stepNumber: 2,
        observation,
        action: {
          type: "click",
          target: { strategy: "role", role: "button", name: "Search" },
          reason: "Submit the member search.",
        },
        policyDecision: { effect: "allow", reason: "Allowed." },
        executionOutcome: { status: "continue" },
        nextObservation: observation,
      },
      {
        stepNumber: 3,
        observation,
        action: {
          type: "complete",
          summary: "The savings balance was found.",
          outputs: { savingsBalance: "$2,450.75" },
          reason: "The requested balance is visible.",
        },
        policyDecision: { effect: "allow", reason: "Allowed." },
        executionOutcome: {
          status: "completed",
          summary: "The savings balance was found.",
          outputs: { savingsBalance: "$2,450.75" },
        },
      },
    ],
  };
}

describe("member lookup artifact generator", () => {
  it("turns the discovered member value into an input reference", () => {
    const result = completedResult();
    const artifact = generateMemberLookupArtifact(
      request,
      result,
      resolveMemberOutputSpecs(request.goal, result.status === "completed" ? result.outputs : {}),
    );
    const firstStep = artifact.steps[0];

    assert.equal(artifact.id, "get_member_savings_balance");
    assert.equal(firstStep?.action, "fill");
    assert.deepEqual(firstStep?.action === "fill" ? firstStep.value : undefined, {
      source: "input",
      name: "memberId",
    });
    assert.equal(artifact.steps.length, 2);
    assert.equal(artifact.outputs.savingsBalance?.source.kind, "table_cell");
    assert.equal(
      artifact.knownOutcomes.some((outcome) => outcome.classification === "intervention"),
      true,
    );
    assert.equal(JSON.stringify(artifact).includes("12345"), false);
  });

  it("rejects generation when no member ID was entered", () => {
    const result = completedResult();
    const firstStep = result.steps[0];
    if (firstStep?.action.type === "fill") {
      firstStep.action.value = "not-a-member-id";
    }

    assert.throws(
      () =>
        generateMemberLookupArtifact(
          request,
          result,
          resolveMemberOutputSpecs(request.goal, {}),
        ),
      /infer.*memberId/,
    );
  });

  it("rejects unrelated literal fill values", () => {
    const result = completedResult();
    result.steps.splice(1, 0, {
      ...result.steps[0]!,
      stepNumber: 2,
      action: {
        type: "fill",
        target: { strategy: "role", role: "textbox", name: "Notes" },
        value: "do-not-persist-this",
        reason: "Enter a literal note.",
      },
    });

    assert.throws(
      () =>
        generateMemberLookupArtifact(
          request,
          result,
          resolveMemberOutputSpecs(request.goal, { savingsBalance: "$2,450.75" }),
        ),
      /non-parameterized/,
    );
  });

  it("creates a member-name capability when the LLM selects memberName", () => {
    const nameRequest = {
      ...request,
      goal: "Find member 12345 and return the account holder name.",
    };
    const result = completedResult();
    if (result.status !== "completed") throw new Error("Expected completed fixture");
    result.outputs = { memberNumber: "12345", memberName: "Alex Morgan" };
    const artifact = generateMemberLookupArtifact(
      nameRequest,
      result,
      resolveMemberOutputSpecs(nameRequest.goal, result.outputs),
    );

    assert.equal(artifact.id, "get_member_name");
    assert.equal(artifact.outputs.memberName?.source.kind, "labeled_value");
    assert.equal(artifact.outputs.savingsBalance, undefined);
  });
});
