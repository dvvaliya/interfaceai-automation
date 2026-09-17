import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SensitiveTokenizer } from "../../src/llm/sensitive-tokenizer.js";

describe("sensitive tokenizer", () => {
  it("hides sensitive values and reverses model placeholders", () => {
    const tokenizer = new SensitiveTokenizer([
      "Find member 12345",
      'Member Name Alex Morgan, balance $2,450.75, account SAV-****-4412',
    ]);
    const tokenized = tokenizer.tokenize({
      goal: "Find member 12345",
      observation: "Alex Morgan has $2,450.75 in SAV-****-4412",
    });
    const serialized = JSON.stringify(tokenized);

    assert.equal(serialized.includes("12345"), false);
    assert.equal(serialized.includes("Alex Morgan"), false);
    assert.equal(serialized.includes("$2,450.75"), false);
    assert.equal(serialized.includes("SAV-****-4412"), false);
    assert.deepEqual(tokenizer.detokenize(tokenized), {
      goal: "Find member 12345",
      observation: "Alex Morgan has $2,450.75 in SAV-****-4412",
    });
  });
});
