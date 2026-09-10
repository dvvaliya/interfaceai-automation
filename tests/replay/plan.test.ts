import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CapabilityArtifact } from "../../src/artifacts/schema.js";
import { resolveReplaySteps } from "../../src/replay/plan.js";

const target = {
  primary: {
    strategy: "role" as const,
    role: "textbox" as const,
    name: "Member Number",
    exact: true,
  },
  fallbacks: [],
  rationale: "Stable member-number label.",
};

const artifact = {
  steps: [
    {
      id: "enter_member_id",
      description: "Enter member ID.",
      risk: "safe",
      action: "fill",
      target,
      value: { source: "input", name: "memberId" },
    },
  ],
} as CapabilityArtifact;

describe("replay plan", () => {
  it("resolves an input reference without changing the artifact", () => {
    const steps = resolveReplaySteps(artifact, { memberId: "24680" });

    assert.equal(steps[0]?.action === "fill" ? steps[0].value : undefined, "24680");
    assert.deepEqual(
      artifact.steps[0]?.action === "fill" ? artifact.steps[0].value : undefined,
      { source: "input", name: "memberId" },
    );
  });
});
