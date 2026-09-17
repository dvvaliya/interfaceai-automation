import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CapturedHumanAction,
  ComputerSurface,
  SurfaceObservation,
  SurfaceTarget,
} from "../../src/surface/types.js";
import { validateMemberBalanceCompletion } from "../../src/targets/bank-demo/validate-member-balance.js";

class CompletionSurface implements ComputerSurface {
  constructor(private readonly checkpointVisible: boolean) {}

  async observe(): Promise<SurfaceObservation> {
    throw new Error("Not used");
  }
  async fill(): Promise<void> {}
  async click(): Promise<void> {}
  async isVisible(target: SurfaceTarget): Promise<boolean> {
    return target.strategy === "role" && target.name === "Member Profile" && this.checkpointVisible;
  }
  async extractText(): Promise<string> {
    throw new Error("Not used");
  }
  async extractTableCell(): Promise<string> {
    return "$2,450.75";
  }
  async beginHumanControl(): Promise<void> {}
  async endHumanControl(): Promise<CapturedHumanAction[]> {
    return [];
  }
}

describe("member balance completion validation", () => {
  it("verifies the checkpoint and extracts a canonical savingsBalance", async () => {
    assert.equal(
      await validateMemberBalanceCompletion(new CompletionSurface(true)),
      "$2,450.75",
    );
  });

  it("rejects model completion before the profile checkpoint", async () => {
    await assert.rejects(
      () => validateMemberBalanceCompletion(new CompletionSurface(false)),
      /checkpoint was visible/,
    );
  });
});
