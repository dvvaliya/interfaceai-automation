import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCapabilityArtifact } from "../../src/artifacts/schema.js";

function validBalanceArtifact(): unknown {
  const roleTarget = (role: "textbox" | "button" | "heading" | "region", name: string) => ({
    primary: { strategy: "role", role, name },
    fallbacks: [],
    rationale: "Uses a stable accessible role and visible business label.",
  });

  return {
    schemaVersion: "1.0",
    capabilityVersion: "1.0.0",
    id: "get_member_savings_balance",
    name: "Get member savings balance",
    description: "Find a member and return the available Regular Savings balance.",
    status: "draft",
    surface: {
      type: "web",
      appId: "meridian_core",
      entryUrl: "https://interfaceai-bank-demo.vercel.app",
      allowedOrigins: ["https://interfaceai-bank-demo.vercel.app"],
    },
    inputs: {
      memberId: {
        type: "string",
        description: "Five-digit member identifier.",
        required: true,
        sensitive: true,
        pattern: "^[0-9]{5}$",
      },
    },
    steps: [
      {
        id: "enter_member_id",
        description: "Enter the requested member identifier.",
        action: "fill",
        risk: "safe",
        target: roleTarget("textbox", "Member Number"),
        value: { source: "input", name: "memberId" },
      },
      {
        id: "submit_member_search",
        description: "Submit the member search.",
        action: "click",
        risk: "safe",
        target: roleTarget("button", "Search"),
      },
    ],
    outputs: {
      savingsBalance: {
        type: "string",
        description: "Available balance of the Regular Savings account.",
        required: true,
        source: {
          kind: "table_cell",
          table: roleTarget("region", "Deposit Accounts"),
          rowMatch: { column: "Type", value: "Regular Savings" },
          column: "Available Balance",
        },
      },
    },
    checkpoint: {
      kind: "visible",
      target: roleTarget("heading", "Member Profile"),
    },
    knownOutcomes: [
      {
        code: "MEMBER_NOT_FOUND",
        classification: "business",
        description: "No member exists for the supplied identifier.",
        whenTextVisible: "No Member Found",
      },
      {
        code: "PERMISSION_DENIED",
        classification: "failure",
        description: "The operator cannot access the requested member.",
        whenTextVisible: "Access Denied",
      },
    ],
  };
}

describe("capability artifact schema", () => {
  it("accepts a typed, parameterized balance capability", () => {
    const artifact = parseCapabilityArtifact(validBalanceArtifact());

    assert.equal(artifact.schemaVersion, "1.0");
    assert.equal(artifact.steps[0]?.action, "fill");
    assert.deepEqual(
      artifact.steps[0]?.action === "fill" ? artifact.steps[0].value : undefined,
      { source: "input", name: "memberId" },
    );
    assert.equal(artifact.outputs.savingsBalance?.source.kind, "table_cell");
  });

  it("rejects a step that references an undeclared input", () => {
    const artifact = validBalanceArtifact() as {
      steps: Array<{ value?: { source: string; name: string } }>;
    };
    artifact.steps[0]!.value = { source: "input", name: "unknownInput" };

    assert.throws(() => parseCapabilityArtifact(artifact), /unknown input/);
  });

  it("rejects duplicate step IDs", () => {
    const artifact = validBalanceArtifact() as {
      steps: Array<{ id: string }>;
    };
    artifact.steps[1]!.id = artifact.steps[0]!.id;

    assert.throws(() => parseCapabilityArtifact(artifact), /Duplicate step ID/);
  });

  it("rejects an unsupported schema version", () => {
    const artifact = validBalanceArtifact() as { schemaVersion: string };
    artifact.schemaVersion = "2.0";

    assert.throws(() => parseCapabilityArtifact(artifact));
  });

  it("rejects an artifact without replay steps", () => {
    const artifact = validBalanceArtifact() as { steps: unknown[] };
    artifact.steps = [];

    assert.throws(() => parseCapabilityArtifact(artifact));
  });
});
