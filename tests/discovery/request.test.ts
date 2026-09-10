import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDiscoveryRequest } from "../../src/discovery/request.js";

describe("discovery request", () => {
  it("accepts and trims a natural-language goal", () => {
    const request = parseDiscoveryRequest({
      goal: "  Find member 12345 and return the savings balance  ",
      target: "http://localhost:3000",
    });

    assert.equal(request.goal, "Find member 12345 and return the savings balance");
    assert.equal(request.target, "http://localhost:3000");
  });

  it("rejects an empty goal", () => {
    assert.throws(() =>
      parseDiscoveryRequest({
        goal: "   ",
        target: "http://localhost:3000",
      }),
    );
  });

  it("rejects an invalid target URL", () => {
    assert.throws(() =>
      parseDiscoveryRequest({
        goal: "Find member 12345",
        target: "not-a-url",
      }),
    );
  });
});
