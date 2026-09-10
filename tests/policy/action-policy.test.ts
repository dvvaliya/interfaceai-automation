import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentAction } from "../../src/actions/schema.js";
import {
  assertPolicyAllows,
  evaluateActionPolicy,
  type ActionPolicy,
} from "../../src/policy/action-policy.js";

const policy: ActionPolicy = {
  allowedOrigins: ["http://localhost:3000"],
  allowedPathPrefixes: ["/login", "/members"],
  allowedActionTypes: ["fill", "click", "complete", "escalate"],
};

describe("action policy", () => {
  it("allows a safe member search action", () => {
    const action = parseAgentAction({
      type: "fill",
      target: { strategy: "role", role: "textbox", name: "Member Number" },
      value: "12345",
      reason: "Enter the requested member.",
    });

    const decision = evaluateActionPolicy(policy, action, {
      currentUrl: "http://localhost:3000/members",
    });

    assert.equal(decision.effect, "allow");
    assert.doesNotThrow(() => assertPolicyAllows(decision));
  });

  it("blocks an origin outside the allowlist", () => {
    const action = parseAgentAction({
      type: "click",
      target: { strategy: "role", role: "button", name: "Search" },
      reason: "Submit the search.",
    });

    const decision = evaluateActionPolicy(policy, action, {
      currentUrl: "https://untrusted.example/members",
    });

    assert.equal(decision.effect, "block");
    assert.throws(() => assertPolicyAllows(decision), { name: "PolicyBlockedError" });
  });

  it("blocks a path outside the allowlist", () => {
    const action = parseAgentAction({
      type: "click",
      target: { strategy: "role", role: "button", name: "Search" },
      reason: "Submit the search.",
    });

    const decision = evaluateActionPolicy(policy, action, {
      currentUrl: "http://localhost:3000/admin/secrets",
    });

    assert.equal(decision.effect, "block");
  });

  it("blocks discovery from entering a password", () => {
    const action = parseAgentAction({
      type: "fill",
      target: { strategy: "role", role: "textbox", name: "Password" },
      value: "do-not-expose-this",
      reason: "Attempt to enter a credential.",
    });

    const decision = evaluateActionPolicy(policy, action, {
      currentUrl: "http://localhost:3000/login",
    });

    assert.equal(decision.effect, "block");
  });

  it("requires approval for account creation", () => {
    const action = parseAgentAction({
      type: "click",
      target: { strategy: "role", role: "button", name: "Create Sub-Account" },
      reason: "Create the requested account.",
    });

    const decision = evaluateActionPolicy(policy, action, {
      currentUrl: "http://localhost:3000/members/12345/sub-account/confirmation",
    });

    assert.equal(decision.effect, "require_approval");
    assert.throws(() => assertPolicyAllows(decision), { name: "ApprovalRequiredError" });
  });

  it("allows escalation even when the surface URL is untrusted", () => {
    const action = parseAgentAction({
      type: "escalate",
      reason: "The browser unexpectedly left the allowed application.",
    });

    const decision = evaluateActionPolicy(policy, action, {
      currentUrl: "https://untrusted.example/",
    });

    assert.equal(decision.effect, "allow");
  });
});
