import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAgentLoop } from "../../src/discovery/agent-loop.js";
import { ScriptedLlmProvider } from "../../src/llm/scripted-provider.js";
import type { ActionPolicy } from "../../src/policy/action-policy.js";
import type {
  ComputerSurface,
  SurfaceObservation,
  SurfaceTarget,
} from "../../src/surface/types.js";

const policy: ActionPolicy = {
  allowedOrigins: ["http://localhost:3000"],
  allowedPathPrefixes: ["/members"],
  allowedActionTypes: ["fill", "click", "complete", "escalate"],
};

class FakeSurface implements ComputerSurface {
  fillCalls: Array<{ target: SurfaceTarget; value: string }> = [];
  clickCalls: SurfaceTarget[] = [];
  observationCount = 0;

  async observe(evidenceName: string): Promise<SurfaceObservation> {
    this.observationCount += 1;
    return {
      url: "http://localhost:3000/members",
      title: "Test Bank",
      accessibilitySnapshot: `observation ${this.observationCount}`,
      screenshotPath: `/tmp/${evidenceName}.png`,
      observedAt: "2026-09-10T00:00:00.000Z",
    };
  }

  async fill(target: SurfaceTarget, value: string): Promise<void> {
    this.fillCalls.push({ target, value });
  }

  async click(target: SurfaceTarget): Promise<void> {
    this.clickCalls.push(target);
  }
}

const fillAction = {
  type: "fill",
  target: { strategy: "role", role: "textbox", name: "Member Number" },
  value: "12345",
  reason: "Enter the requested member.",
};

describe("discovery agent loop", () => {
  it("runs multiple turns until the model completes the goal", async () => {
    const surface = new FakeSurface();
    const provider = new ScriptedLlmProvider([
      fillAction,
      {
        type: "click",
        target: { strategy: "role", role: "button", name: "Search" },
        reason: "Submit the member search.",
      },
      {
        type: "complete",
        summary: "The savings balance was found.",
        outputs: { savingsBalance: "$2,450.75" },
        reason: "The member profile displays the balance.",
      },
    ]);

    const result = await runAgentLoop({
      goal: "Find member 12345 and return the savings balance.",
      provider,
      surface,
      policy,
      maxSteps: 5,
      timeoutMs: 10_000,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.steps.length, 3);
    assert.equal(surface.fillCalls.length, 1);
    assert.equal(surface.clickCalls.length, 1);
    assert.equal(provider.requests[2]?.actionHistory.length, 2);
  });

  it("stops before executing an action that requires approval", async () => {
    const surface = new FakeSurface();
    const provider = new ScriptedLlmProvider([
      {
        type: "click",
        target: { strategy: "role", role: "button", name: "Create Sub-Account" },
        reason: "Create the requested account.",
      },
    ]);

    const result = await runAgentLoop({
      goal: "Create a sub-account.",
      provider,
      surface,
      policy,
      maxSteps: 5,
      timeoutMs: 10_000,
    });

    assert.equal(result.status, "escalated");
    assert.equal(surface.clickCalls.length, 0);
  });

  it("stops when the model repeats the same action", async () => {
    const surface = new FakeSurface();
    const provider = new ScriptedLlmProvider([fillAction, fillAction, fillAction]);

    const result = await runAgentLoop({
      goal: "Find member 12345.",
      provider,
      surface,
      policy,
      maxSteps: 5,
      timeoutMs: 10_000,
      maxRepeatedActions: 2,
    });

    assert.equal(result.status, "failed");
    assert.equal(surface.fillCalls.length, 2);
  });

  it("stops at the configured maximum step count", async () => {
    const surface = new FakeSurface();
    const provider = new ScriptedLlmProvider([fillAction]);

    const result = await runAgentLoop({
      goal: "Find member 12345.",
      provider,
      surface,
      policy,
      maxSteps: 1,
      timeoutMs: 10_000,
    });

    assert.equal(result.status, "failed");
    assert.match(result.status === "failed" ? result.reason : "", /maximum of 1 steps/);
  });
});
