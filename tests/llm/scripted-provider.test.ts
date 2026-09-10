import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ScriptedLlmProvider } from "../../src/llm/scripted-provider.js";
import type { LlmDecisionRequest } from "../../src/llm/provider.js";

const request: LlmDecisionRequest = {
  goal: "Find member 12345.",
  stepNumber: 1,
  actionHistory: [],
  observation: {
    url: "http://localhost:3000/members",
    title: "Meridian Core Operations",
    accessibilitySnapshot: 'textbox "Member Number"\nbutton "Search"',
    screenshotPath: "/tmp/step-1.png",
    observedAt: "2026-09-10T00:00:00.000Z",
  },
};

describe("scripted LLM provider", () => {
  it("returns scripted responses in order and records requests", async () => {
    const fillResponse = {
      type: "fill",
      target: { strategy: "role", role: "textbox", name: "Member Number" },
      value: "12345",
      reason: "Enter the requested member.",
    };
    const completeResponse = {
      type: "complete",
      summary: "The member was found.",
      outputs: {},
      reason: "The member profile is visible.",
    };
    const provider = new ScriptedLlmProvider([fillResponse, completeResponse]);

    assert.deepEqual(await provider.decideNextAction(request), fillResponse);
    assert.deepEqual(
      await provider.decideNextAction({ ...request, stepNumber: 2 }),
      completeResponse,
    );
    assert.equal(provider.requests.length, 2);
    assert.equal(provider.requests[0]?.goal, "Find member 12345.");
  });

  it("fails clearly when the script has no response for a step", async () => {
    const provider = new ScriptedLlmProvider([]);

    await assert.rejects(() => provider.decideNextAction(request), {
      message: "Scripted LLM provider has no response for step 1.",
    });
  });
});
