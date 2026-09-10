import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentAction } from "../../src/actions/schema.js";
import {
  assertPolicyAllows,
  evaluateActionPolicy,
  evaluateLocationPolicy,
  evaluateOriginPolicy,
  type ActionPolicy,
} from "../../src/policy/action-policy.js";

const policy: ActionPolicy = {
  allowedOrigins: ["http://localhost:3000"],
  allowedPathPrefixes: ["/login", "/members"],
  allowedActionTypes: ["fill", "click", "complete", "escalate"],
};

describe("action policy", () => {
  it("allows an approved target origin before navigation", () => {
    const decision = evaluateOriginPolicy(policy, "http://localhost:3000/");

    assert.equal(decision.effect, "allow");
  });

  it("checks the route after navigation", () => {
    assert.equal(
      evaluateLocationPolicy(policy, "http://localhost:3000/members/12345").effect,
      "allow",
    );
    assert.equal(
      evaluateLocationPolicy(policy, "http://localhost:3000/admin").effect,
      "block",
    );
  });

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

  it("reports the browser error page as a navigation failure", () => {
    const decision = evaluateOriginPolicy(policy, "chrome-error://chromewebdata/");

    assert.deepEqual(decision, {
      effect: "block",
      reason: "Browser navigation failed and opened an internal error page, likely due to a transient network timeout.",
    });
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

  it("uses a restricted-record reason for protected record access", () => {
    const action = parseAgentAction({
      type: "click",
      target: { strategy: "role", role: "link", name: "Continue and record access" },
      reason: "Continue to the restricted record.",
    });

    const decision = evaluateActionPolicy(policy, action, {
      currentUrl: "http://localhost:3000/members/result?memberId=33333",
    });

    assert.deepEqual(decision, {
      effect: "require_approval",
      reason: "Accessing a restricted member record requires human approval.",
    });
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
