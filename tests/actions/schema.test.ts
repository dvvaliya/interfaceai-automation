import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentAction } from "../../src/actions/schema.js";

describe("agent action schema", () => {
  it("accepts a valid fill action", () => {
    const action = parseAgentAction({
      type: "fill",
      target: {
        strategy: "role",
        role: "textbox",
        name: "Member Number",
      },
      value: "12345",
      reason: "Enter the member requested by the goal.",
    });

    assert.equal(action.type, "fill");
    assert.equal(action.value, "12345");
  });

  it("accepts a valid click action", () => {
    const action = parseAgentAction({
      type: "click",
      target: {
        strategy: "role",
        role: "button",
        name: "Search",
      },
      reason: "Submit the member search.",
    });

    assert.equal(action.type, "click");
    assert.equal(action.target.name, "Search");
  });

  it("accepts a valid complete action", () => {
    const action = parseAgentAction({
      type: "complete",
      summary: "The requested member balance was found.",
      outputs: { savingsBalance: "$2,450.75" },
      reason: "The member profile displays the savings balance.",
    });

    assert.equal(action.type, "complete");
    assert.deepEqual(action.outputs, { savingsBalance: "$2,450.75" });
  });

  it("accepts a valid escalate action", () => {
    const action = parseAgentAction({
      type: "escalate",
      reason: "A restricted-record warning requires human approval.",
    });

    assert.equal(action.type, "escalate");
  });

  it("accepts business-outcome and failure actions", () => {
    assert.equal(
      parseAgentAction({
        type: "business_outcome",
        code: "INVALID_INPUT",
        message: "Member ID must contain five digits.",
        reason: "The supplied ID has four digits.",
      }).type,
      "business_outcome",
    );
    assert.equal(
      parseAgentAction({
        type: "fail",
        category: "hard",
        code: "APPLICATION_ERROR",
        message: "The core service is unavailable.",
        reason: "The application displayed an internal error.",
      }).type,
      "fail",
    );
  });

  it("rejects an unsupported action type", () => {
    assert.throws(() =>
      parseAgentAction({
        type: "execute-javascript",
        code: "document.cookie",
        reason: "Bypass the controlled surface.",
      }),
    );
  });

  it("rejects filling a button", () => {
    assert.throws(() =>
      parseAgentAction({
        type: "fill",
        target: {
          strategy: "role",
          role: "button",
          name: "Search",
        },
        value: "12345",
        reason: "This target is incompatible with fill.",
      }),
    );
  });

  it("rejects unexpected properties", () => {
    assert.throws(() =>
      parseAgentAction({
        type: "click",
        target: {
          strategy: "role",
          role: "button",
          name: "Search",
        },
        reason: "Submit the search.",
        script: "malicious extra field",
      }),
    );
  });

  it("rejects a complete action without a summary", () => {
    assert.throws(() =>
      parseAgentAction({
        type: "complete",
        outputs: {},
        reason: "The model omitted the required summary.",
      }),
    );
  });
});
