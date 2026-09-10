import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CapabilityArtifact } from "../../src/artifacts/schema.js";
import type { ActionPolicy } from "../../src/policy/action-policy.js";
import { executeReplay } from "../../src/replay/executor.js";
import { resolveReplaySteps } from "../../src/replay/plan.js";
import type {
  ComputerSurface,
  SurfaceObservation,
  SurfaceTarget,
} from "../../src/surface/types.js";

const roleTarget = (role: "textbox" | "button" | "heading" | "region", name: string) => ({
  primary: { strategy: "role" as const, role, name, exact: true },
  fallbacks: [],
  rationale: "Stable accessible role and name.",
});

const artifact = {
  schemaVersion: "1.0",
  capabilityVersion: "1.0.0",
  id: "get_member_savings_balance",
  name: "Get member savings balance",
  description: "Find a member and return the savings balance.",
  status: "draft",
  surface: {
    type: "web",
    appId: "meridian_core",
    entryUrl: "http://localhost:3000",
    allowedOrigins: ["http://localhost:3000"],
  },
  inputs: {},
  steps: [
    {
      id: "fill_member",
      description: "Enter member ID.",
      risk: "safe",
      action: "fill",
      target: roleTarget("textbox", "Member Number"),
      value: { source: "literal", value: "24680" },
    },
    {
      id: "search_member",
      description: "Search for member.",
      risk: "safe",
      action: "click",
      target: roleTarget("button", "Search"),
    },
  ],
  outputs: {
    savingsBalance: {
      type: "string",
      description: "Savings balance.",
      required: true,
      source: {
        kind: "table_cell",
        table: roleTarget("region", "Deposit Accounts"),
        rowMatch: { column: "Type", value: "Regular Savings" },
        column: "Available Balance",
      },
    },
  },
  checkpoint: { kind: "visible", target: roleTarget("heading", "Member Profile") },
  knownOutcomes: [
    {
      code: "MEMBER_NOT_FOUND",
      classification: "business",
      description: "No member exists.",
      whenTextVisible: "No Member Found",
    },
  ],
} as CapabilityArtifact;

const policy: ActionPolicy = {
  allowedOrigins: ["http://localhost:3000"],
  allowedPathPrefixes: ["/members"],
  allowedActionTypes: ["fill", "click"],
};

class FakeReplaySurface implements ComputerSurface {
  fillCalls = 0;
  clickCalls = 0;

  constructor(private readonly visibleText?: string) {}

  async observe(evidenceName: string): Promise<SurfaceObservation> {
    return {
      url: "http://localhost:3000/members/24680",
      title: "Test Bank",
      accessibilitySnapshot: "Member Profile",
      screenshotPath: `/tmp/${evidenceName}.png`,
      observedAt: "2026-09-10T00:00:00.000Z",
    };
  }

  async fill(): Promise<void> {
    this.fillCalls += 1;
  }

  async click(): Promise<void> {
    this.clickCalls += 1;
  }

  async isVisible(target: SurfaceTarget): Promise<boolean> {
    if (target.strategy === "role" && target.role === "heading") return true;
    return target.strategy === "text" && target.text === this.visibleText;
  }

  async extractText(): Promise<string> {
    return "unused";
  }

  async extractTableCell(): Promise<string> {
    return "$8,102.30";
  }
}

describe("deterministic replay executor", () => {
  it("executes saved steps, verifies the checkpoint, and extracts outputs", async () => {
    const surface = new FakeReplaySurface();
    const steps = resolveReplaySteps(artifact, {});

    const result = await executeReplay({ artifact, steps, surface, policy });

    assert.equal(result.status, "success");
    assert.deepEqual(result.status === "success" ? result.outputs : {}, {
      savingsBalance: "$8,102.30",
    });
    assert.equal(surface.fillCalls, 1);
    assert.equal(surface.clickCalls, 1);
  });

  it("returns a known business outcome instead of a failure", async () => {
    const surface = new FakeReplaySurface("No Member Found");
    const steps = resolveReplaySteps(artifact, {});

    const result = await executeReplay({ artifact, steps, surface, policy });

    assert.equal(result.status, "business_outcome");
    assert.equal(result.status === "business_outcome" ? result.code : "", "MEMBER_NOT_FOUND");
  });
});
