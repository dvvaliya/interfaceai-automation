import type { CapturedHumanAction, HumanActionEvent } from "../surface/types.js";

export type { CapturedHumanAction, HumanActionEvent } from "../surface/types.js";

export type ControlOwner = "AUTOMATION" | "HUMAN" | "NONE";
export type InterventionStatus = "open" | "human_control" | "resumed" | "completed" | "aborted" | "timed_out";

export type InterventionRequest = {
  id: string;
  capabilityId: string;
  stepId: string;
  reason: string;
  currentUrl: string;
  screenshotPath: string;
  blockerText?: string;
  controlOwner: ControlOwner;
  status: InterventionStatus;
  resumeAttempts: number;
  humanActions: HumanActionEvent[];
  createdAt: string;
  updatedAt: string;
};
