import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentAction } from "../../src/actions/schema.js";
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

class NavigationTimeoutSurface extends FakeSurface {
  override async click(): Promise<void> {
    this.clickCalls += 1;
    throw new Error("Click timed out while waiting for navigation.");
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
    const progress: string[] = [];
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
      onProgress: (message) => progress.push(message),
    });

    assert.equal(result.status, "completed");
    assert.equal(result.steps.length, 3);
    assert.equal(surface.fillCalls.length, 1);
    assert.equal(surface.clickCalls.length, 1);
    assert.equal(provider.requests[2]?.actionHistory.length, 2);
    assert.equal(progress.some((message) => message.includes("[llm] Step 1: requesting")), true);
    assert.equal(progress.some((message) => message.includes("validated 'fill'")), true);
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

  it("preserves action history and step numbering after a handoff", async () => {
    const surface = new FakeSurface();
    const provider = new ScriptedLlmProvider([
      {
        type: "complete",
        summary: "The human resolved the blocker.",
        outputs: {},
        reason: "The requested page is now visible.",
      },
    ]);

    const result = await runAgentLoop({
      goal: "Find member 33333.",
      provider,
      surface,
      policy,
      maxSteps: 3,
      timeoutMs: 10_000,
      initialActionHistory: [parseAgentAction(fillAction)],
      stepNumberOffset: 1,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.steps[0]?.stepNumber, 2);
    assert.equal(provider.requests[0]?.actionHistory.length, 1);
  });

  it("continues when a timed-out click still changed the observed page", async () => {
    const surface = new NavigationTimeoutSurface();
    const provider = new ScriptedLlmProvider([
      {
        type: "click",
        target: { strategy: "role", role: "button", name: "Search" },
        reason: "Submit the member search.",
      },
      {
        type: "escalate",
        reason: "The resulting page requires a human decision.",
      },
    ]);

    const result = await runAgentLoop({
      goal: "Find member 33333.",
      provider,
      surface,
      policy,
      maxSteps: 3,
      timeoutMs: 10_000,
    });

    assert.equal(result.status, "escalated");
    assert.match(result.steps[0]?.executionWarning ?? "", /timed out/);
  });

  it("returns invalid input as a business outcome without handoff", async () => {
    const surface = new FakeSurface();
    const provider = new ScriptedLlmProvider([
      {
        type: "business_outcome",
        code: "INVALID_INPUT",
        message: "Member ID must contain exactly five digits.",
        reason: "The goal contains a four-digit member ID.",
      },
    ]);

    const result = await runAgentLoop({
      goal: "Find member 5000.",
      provider,
      surface,
      policy: {
        ...policy,
        allowedActionTypes: [...policy.allowedActionTypes, "business_outcome", "fail"],
      },
      maxSteps: 3,
      timeoutMs: 10_000,
    });

    assert.equal(result.status, "business_outcome");
    assert.equal(result.status === "business_outcome" ? result.code : "", "INVALID_INPUT");
    assert.equal(surface.fillCalls.length, 0);
    assert.equal(surface.clickCalls.length, 0);
  });
});
