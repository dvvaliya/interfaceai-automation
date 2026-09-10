import type { LlmDecisionRequest, LlmProvider } from "./provider.js";

export class ScriptedLlmProvider implements LlmProvider {
  readonly name = "scripted";
  readonly requests: LlmDecisionRequest[] = [];
  private responseIndex = 0;

  constructor(private readonly responses: readonly unknown[]) {}

  async decideNextAction(request: LlmDecisionRequest): Promise<unknown> {
    const response = this.responses[this.responseIndex];

    if (response === undefined) {
      throw new Error(`Scripted LLM provider has no response for step ${request.stepNumber}.`);
    }

    this.requests.push(request);
    this.responseIndex += 1;
    return response;
  }
}
