import type { AgentAction } from "../actions/schema.js";
import type { SurfaceObservation } from "../surface/types.js";

export type LlmDecisionRequest = {
  goal: string;
  observation: SurfaceObservation;
  stepNumber: number;
  actionHistory: readonly AgentAction[];
};

export interface LlmProvider {
  readonly name: string;
  decideNextAction(request: LlmDecisionRequest): Promise<unknown>;
}
