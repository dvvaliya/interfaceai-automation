import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CapturedHumanAction,
  ComputerSurface,
  SurfaceObservation,
  SurfaceTarget,
} from "../../src/surface/types.js";
import {
  extractMemberOutputs,
  resolveMemberOutputSpecs,
} from "../../src/targets/bank-demo/member-output-specs.js";

class OutputSurface implements ComputerSurface {
  async observe(): Promise<SurfaceObservation> {
    throw new Error("Not used");
  }
  async fill(): Promise<void> {}
  async click(): Promise<void> {}
  async isVisible(): Promise<boolean> {
    return true;
  }
  async extractText(): Promise<string> {
    throw new Error("Not used");
  }
  async extractTableCell(
    _target: SurfaceTarget,
    _row: { column: string; value: string },
    column: string,
  ): Promise<string> {
    return column === "Available Balance" ? "$2,450.75" : "SAV-****-4412";
  }
  async extractLabeledValue(_target: SurfaceTarget, label: string): Promise<string> {
    return label === "Member Name" ? "Alex Morgan" : "Active";
  }
  async beginHumanControl(): Promise<void> {}
  async endHumanControl(): Promise<CapturedHumanAction[]> {
    return [];
  }
}

describe("member output specifications", () => {
  it("selects and extracts only the name requested by the goal", async () => {
    const specs = resolveMemberOutputSpecs(
      "Find member 12345 and return the account holder name",
      { memberNumber: "12345", memberName: "Alex Morgan", savingsBalance: "$2,450.75" },
    );

    assert.deepEqual(specs.map((spec) => spec.outputName), ["memberName"]);
    assert.deepEqual(await extractMemberOutputs(new OutputSurface(), specs), {
      memberName: "Alex Morgan",
    });
  });

  it("selects savings balance for a balance goal", () => {
    const specs = resolveMemberOutputSpecs("Return the savings balance", {
      savingsBalance: "$2,450.75",
    });

    assert.deepEqual(specs.map((spec) => spec.outputName), ["savingsBalance"]);
  });
});
