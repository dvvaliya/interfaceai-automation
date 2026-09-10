import type { ComputerSurface } from "../surface/types.js";
import type { AgentAction } from "./schema.js";

export type ExecutionOutcome =
  | { status: "continue" }
  | { status: "completed"; summary: string; outputs: Record<string, string> }
  | { status: "business_outcome"; code: string; message: string }
  | { status: "escalated"; reason: string }
  | { status: "failed"; category: "recoverable" | "hard"; code: string; message: string };

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

    case "business_outcome":
      return {
        status: "business_outcome",
        code: action.code,
        message: action.message,
      };

    case "fail":
      return {
        status: "failed",
        category: action.category,
        code: action.code,
        message: action.message,
      };

    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported validated action: ${JSON.stringify(value)}`);
}
