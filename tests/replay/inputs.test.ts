import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CapabilityArtifact } from "../../src/artifacts/schema.js";
import { resolveReplayInputs } from "../../src/replay/inputs.js";

const definitions: CapabilityArtifact["inputs"] = {
  memberId: {
    type: "string",
    description: "Five-digit member identifier.",
    required: true,
    sensitive: true,
    pattern: "^[0-9]{5}$",
  },
};

describe("replay inputs", () => {
  it("validates a declared input", () => {
    assert.deepEqual(resolveReplayInputs(definitions, ["memberId=24680"]), {
      memberId: "24680",
    });
  });

  it("rejects a missing required input", () => {
    assert.throws(() => resolveReplayInputs(definitions, []), /Missing required/);
  });

  it("rejects an unknown input", () => {
    assert.throws(() => resolveReplayInputs(definitions, ["customerId=24680"]), /Unknown/);
  });

  it("rejects a value that does not match its pattern", () => {
    assert.throws(() => resolveReplayInputs(definitions, ["memberId=abc"]), /does not match/);
  });
});
