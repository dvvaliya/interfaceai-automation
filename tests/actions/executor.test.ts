import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeAction } from "../../src/actions/executor.js";
import { parseAgentAction } from "../../src/actions/schema.js";
import type {
  ComputerSurface,
  SurfaceObservation,
  SurfaceTarget,
} from "../../src/surface/types.js";

class FakeSurface implements ComputerSurface {
  fillCalls: Array<{ target: SurfaceTarget; value: string }> = [];
  clickCalls: SurfaceTarget[] = [];

  async observe(): Promise<SurfaceObservation> {
    throw new Error("observe is not used by executor tests");
  }

  async fill(target: SurfaceTarget, value: string): Promise<void> {
    this.fillCalls.push({ target, value });
  }

  async click(target: SurfaceTarget): Promise<void> {
    this.clickCalls.push(target);
  }
}

describe("action executor", () => {
  it("routes a fill action to the surface", async () => {
    const surface = new FakeSurface();
    const action = parseAgentAction({
      type: "fill",
      target: { strategy: "role", role: "textbox", name: "Member Number" },
      value: "12345",
      reason: "Enter the requested member.",
    });

    const outcome = await executeAction(surface, action);

    assert.deepEqual(surface.fillCalls, [
      {
        target: { strategy: "role", role: "textbox", name: "Member Number" },
        value: "12345",
      },
    ]);
    assert.equal(surface.clickCalls.length, 0);
    assert.deepEqual(outcome, { status: "continue" });
  });

  it("routes a click action to the surface", async () => {
    const surface = new FakeSurface();
    const action = parseAgentAction({
      type: "click",
      target: { strategy: "role", role: "button", name: "Search" },
      reason: "Submit the search.",
    });

    const outcome = await executeAction(surface, action);

    assert.deepEqual(surface.clickCalls, [
      { strategy: "role", role: "button", name: "Search" },
    ]);
    assert.equal(surface.fillCalls.length, 0);
    assert.deepEqual(outcome, { status: "continue" });
  });

  it("returns completion data without touching the surface", async () => {
    const surface = new FakeSurface();
    const action = parseAgentAction({
      type: "complete",
      summary: "The requested balance was found.",
      outputs: { savingsBalance: "$2,450.75" },
      reason: "The balance is visible on the member profile.",
    });

    const outcome = await executeAction(surface, action);

    assert.deepEqual(outcome, {
      status: "completed",
      summary: "The requested balance was found.",
      outputs: { savingsBalance: "$2,450.75" },
    });
    assert.equal(surface.fillCalls.length, 0);
    assert.equal(surface.clickCalls.length, 0);
  });

  it("returns escalation data without touching the surface", async () => {
    const surface = new FakeSurface();
    const action = parseAgentAction({
      type: "escalate",
      reason: "A human must review the restricted record warning.",
    });

    const outcome = await executeAction(surface, action);

    assert.deepEqual(outcome, {
      status: "escalated",
      reason: "A human must review the restricted record warning.",
    });
    assert.equal(surface.fillCalls.length, 0);
    assert.equal(surface.clickCalls.length, 0);
  });

  it("returns a business outcome without touching the surface", async () => {
    const surface = new FakeSurface();
    const action = parseAgentAction({
      type: "business_outcome",
      code: "INVALID_INPUT",
      message: "Member ID must contain five digits.",
      reason: "The supplied ID has four digits.",
    });

    const outcome = await executeAction(surface, action);

    assert.deepEqual(outcome, {
      status: "business_outcome",
      code: "INVALID_INPUT",
      message: "Member ID must contain five digits.",
    });
    assert.equal(surface.fillCalls.length, 0);
    assert.equal(surface.clickCalls.length, 0);
  });

  it("returns a typed failure without touching the surface", async () => {
    const surface = new FakeSurface();
    const action = parseAgentAction({
      type: "fail",
      category: "hard",
      code: "APPLICATION_ERROR",
      message: "The core service is unavailable.",
      reason: "The application displayed an internal error.",
    });

    const outcome = await executeAction(surface, action);

    assert.deepEqual(outcome, {
      status: "failed",
      category: "hard",
      code: "APPLICATION_ERROR",
      message: "The core service is unavailable.",
    });
  });
});
