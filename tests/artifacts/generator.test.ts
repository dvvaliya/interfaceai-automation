import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateMemberBalanceArtifact } from "../../src/artifacts/generator.js";
import type { AgentLoopResult } from "../../src/discovery/agent-loop.js";
import type { DiscoveryRequest } from "../../src/discovery/request.js";
import type { SurfaceObservation } from "../../src/surface/types.js";

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

describe("member balance artifact generator", () => {
  it("turns the discovered member value into an input reference", () => {
    const artifact = generateMemberBalanceArtifact(request, completedResult());
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

    assert.throws(() => generateMemberBalanceArtifact(request, result), /infer.*memberId/);
  });
});
