import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HandoffController } from "../../src/handoff/controller.js";
import type { SurfaceObservation } from "../../src/surface/types.js";

const before: SurfaceObservation = {
  url: "http://localhost:3000/members/result?memberId=33333",
  title: "Test Bank",
  accessibilitySnapshot: 'dialog "Restricted Record Warning"',
  screenshotPath: "/tmp/handoff-before.png",
  observedAt: "2026-09-10T00:00:00.000Z",
};

function createController(): HandoffController {
  return new HandoffController({
    capabilityId: "get_member_savings_balance",
    stepId: "search_member",
    reason: "Restricted record review requires a human.",
    blockerText: "Restricted Record Warning",
    observation: before,
  });
}

describe("handoff controller", () => {
  it("keeps control with the human when nothing changed", () => {
    const controller = createController();
    controller.cedeToHuman();

    const result = controller.tryResume({
      observation: before,
      blockerVisible: false,
      locationAllowed: true,
    });

    assert.equal(result.resumed, false);
    assert.equal(controller.snapshot().controlOwner, "HUMAN");
  });

  it("keeps control with the human while the blocker remains", () => {
    const controller = createController();
    controller.cedeToHuman();
    controller.recordHumanAction({
      type: "click",
      capture: "exact",
      role: "button",
      name: "Unrelated action",
      timestamp: "2026-09-10T00:00:01.000Z",
    });

    const result = controller.tryResume({
      observation: { ...before, accessibilitySnapshot: "changed" },
      blockerVisible: true,
      locationAllowed: true,
    });

    assert.equal(result.resumed, false);
    assert.equal(controller.snapshot().controlOwner, "HUMAN");
  });

  it("returns control to automation after the blocker is resolved", () => {
    const controller = createController();
    controller.cedeToHuman();
    controller.recordHumanAction({
      type: "click",
      capture: "exact",
      role: "link",
      name: "Continue and record access",
      timestamp: "2026-09-10T00:00:01.000Z",
    });

    const result = controller.tryResume({
      observation: {
        ...before,
        url: "http://localhost:3000/members/33333",
        accessibilitySnapshot: 'heading "Member Profile"',
      },
      blockerVisible: false,
      locationAllowed: true,
    });

    assert.equal(result.resumed, true);
    assert.equal(controller.snapshot().controlOwner, "AUTOMATION");
    assert.equal(controller.snapshot().humanActions.length, 1);
  });

  it("does not record events while automation owns control", () => {
    const controller = createController();
    controller.recordHumanAction({
      type: "change",
      capture: "exact",
      role: "input",
      name: "Member Number",
      timestamp: "2026-09-10T00:00:01.000Z",
    });

    assert.equal(controller.snapshot().humanActions.length, 0);
  });

  it("records a coarse navigation when the page changed but the DOM click event was lost", () => {
    const controller = createController();
    controller.cedeToHuman();

    const result = controller.tryResume({
      observation: {
        ...before,
        url: "http://localhost:3000/members/33333",
        accessibilitySnapshot: 'heading "Member Profile"',
      },
      blockerVisible: false,
      locationAllowed: true,
    });

    assert.equal(result.resumed, true);
    assert.equal(controller.snapshot().humanActions[0]?.type, "navigation");
  });
});
