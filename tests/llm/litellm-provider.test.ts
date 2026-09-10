import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LiteLlmProvider } from "../../src/llm/litellm-provider.js";
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

describe("LiteLLM provider", () => {
  it("returns parsed JSON from an OpenAI-compatible response", async () => {
    const expectedAction = {
      type: "fill",
      target: { strategy: "role", role: "textbox", name: "Member Number" },
      value: "12345",
      reason: "Enter the requested member.",
    };
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(expectedAction) } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const provider = new LiteLlmProvider(
      { baseUrl: "https://llm.example/v1/chat/completions", apiKey: "test-key", model: "test" },
      fakeFetch,
    );

    assert.deepEqual(await provider.decideNextAction(request), expectedAction);
  });

  it("reports a failed HTTP response", async () => {
    const fakeFetch: typeof fetch = async () => new Response("unauthorized", { status: 401 });
    const provider = new LiteLlmProvider(
      { baseUrl: "https://llm.example/v1/chat/completions", apiKey: "bad-key", model: "test" },
      fakeFetch,
    );

    await assert.rejects(() => provider.decideNextAction(request), /HTTP 401/);
  });
});
