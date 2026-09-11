import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { RunEvidence } from "../../src/observability/run-evidence.js";

describe("run evidence", () => {
  it("writes run-scoped JSONL and redacts secrets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "interfaceai-evidence-"));

    try {
      const run = await RunEvidence.create("discovery", {
        rootDirectory: root,
        runId: "test-run",
        redactionValues: ["12345"],
      });
      run.record("started", {
        goal: "Find member 12345",
        password: "do-not-store",
        apiKey: "sk-example-secret",
      });
      run.addRedactionValues(["Alex Morgan", "$2,450.75"]);
      await run.writeJson("result.json", {
        memberName: "Alex Morgan",
        summary: "Alex Morgan has a balance of $2,450.75",
      });
      await run.flush();

      const log = await readFile(run.logPath, "utf8");
      const result = await readFile(path.join(run.directory, "result.json"), "utf8");
      assert.match(log, /"event":"started"/);
      assert.equal(log.includes("12345"), false);
      assert.equal(log.includes("do-not-store"), false);
      assert.equal(log.includes("sk-example-secret"), false);
      assert.equal(result.includes("Alex Morgan"), false);
      assert.equal(result.includes("$2,450.75"), false);
      assert.match(run.logPath, /discovery\/test-run\/run\.jsonl$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
