import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBrowserRequestAllowed,
  type BrowserRequestGuardPolicy,
} from "../../src/policy/browser-request-guard.js";

const policy: BrowserRequestGuardPolicy = {
  allowedOrigins: ["https://bank.example"],
  allowedPathPrefixes: ["/", "/login", "/members"],
};

describe("browser request guard", () => {
  it("allows the configured entry URL and member routes", () => {
    assert.equal(isBrowserRequestAllowed("https://bank.example/", true, policy), true);
    assert.equal(
      isBrowserRequestAllowed("https://bank.example/members/12345", true, policy),
      true,
    );
  });

  it("blocks navigation to disallowed routes and origins before request", () => {
    assert.equal(isBrowserRequestAllowed("https://bank.example/admin", true, policy), false);
    assert.equal(isBrowserRequestAllowed("https://evil.example/members", true, policy), false);
  });

  it("allows same-origin API and asset requests", () => {
    assert.equal(isBrowserRequestAllowed("https://bank.example/api/session", false, policy), true);
    assert.equal(isBrowserRequestAllowed("https://bank.example/app.css", false, policy), true);
  });

  it("allows local data resources but blocks unsupported schemes", () => {
    assert.equal(isBrowserRequestAllowed("data:text/plain,hello", false, policy), true);
    assert.equal(isBrowserRequestAllowed("data:text/html,unsafe", true, policy), false);
    assert.equal(isBrowserRequestAllowed("blob:https://bank.example/id", true, policy), false);
    assert.equal(isBrowserRequestAllowed("file:///tmp/secret", true, policy), false);
  });
});
