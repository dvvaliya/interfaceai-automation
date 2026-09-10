import type { ComputerSurface } from "../surface/types.js";
import type { AgentAction } from "./schema.js";

export type ExecutionOutcome =
  | { status: "continue" }
  | { status: "completed"; summary: string; outputs: Record<string, string> }
  | { status: "escalated"; reason: string };

export async function executeAction(
  surface: ComputerSurface,
  action: AgentAction,
): Promise<ExecutionOutcome> {
  switch (action.type) {
    case "fill":
      await surface.fill(action.target, action.value);
      return { status: "continue" };

    case "click":
      await surface.click(action.target);
      return { status: "continue" };

    case "complete":
      return {
        status: "completed",
        summary: action.summary,
        outputs: action.outputs,
      };

    case "escalate":
      return {
        status: "escalated",
        reason: action.reason,
      };

    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported validated action: ${JSON.stringify(value)}`);
}
