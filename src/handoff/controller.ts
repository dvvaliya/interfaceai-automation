import { createHash, randomUUID } from "node:crypto";
import type { SurfaceObservation } from "../surface/types.js";
import type { CapturedHumanAction, InterventionRequest } from "./types.js";

export class HandoffController {
  private readonly baselineFingerprint: string;
  private readonly request: InterventionRequest;

  constructor(input: {
    capabilityId: string;
    stepId: string;
    reason: string;
    blockerText?: string;
    observation: SurfaceObservation;
  }) {
    const now = new Date().toISOString();
    this.baselineFingerprint = fingerprint(input.observation);
    this.request = {
      id: randomUUID(),
      capabilityId: input.capabilityId,
      stepId: input.stepId,
      reason: input.reason,
      currentUrl: redactUrl(input.observation.url),
      screenshotPath: input.observation.screenshotPath,
      blockerText: input.blockerText,
      controlOwner: "AUTOMATION",
      status: "open",
      resumeAttempts: 0,
      humanActions: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  cedeToHuman(): void {
    this.request.controlOwner = "HUMAN";
    this.request.status = "human_control";
    this.touch();
  }

  recordHumanAction(action: CapturedHumanAction): void {
    if (this.request.controlOwner === "HUMAN") {
      this.request.humanActions.push({
        ...action,
        sequence: this.request.humanActions.length + 1,
      });
      this.touch();
    }
  }

  tryResume(input: {
    observation: SurfaceObservation;
    blockerVisible: boolean;
    locationAllowed: boolean;
  }): { resumed: boolean; reason: string } {
    if (this.request.controlOwner !== "HUMAN") {
      return { resumed: false, reason: "Control is not currently assigned to the human." };
    }

    this.request.resumeAttempts += 1;
    this.request.currentUrl = redactUrl(input.observation.url);
    this.request.screenshotPath = input.observation.screenshotPath;
    this.touch();

    if (!input.locationAllowed) {
      return { resumed: false, reason: "The browser is outside the allowlisted application." };
    }

    if (input.blockerVisible) {
      return { resumed: false, reason: "The blocking condition is still visible." };
    }

    const unchanged = fingerprint(input.observation) === this.baselineFingerprint;
    if (unchanged && this.request.humanActions.length === 0) {
      return { resumed: false, reason: "The page is unchanged and no human action was recorded." };
    }

    if (!unchanged && this.request.humanActions.length === 0) {
      this.request.humanActions.push({
        sequence: 1,
        type: "navigation",
        capture: "inferred",
        role: "document",
        name: `Page changed to ${redactUrl(input.observation.url)}`,
        description: "The page changed during human control, but the exact DOM event was unavailable.",
        timestamp: new Date().toISOString(),
      });
    }

    this.request.controlOwner = "AUTOMATION";
    this.request.status = "resumed";
    this.touch();
    return { resumed: true, reason: "The blocker was resolved and control returned to automation." };
  }

  complete(): void {
    this.request.controlOwner = "NONE";
    this.request.status = "completed";
    this.touch();
  }

  abort(): void {
    this.request.controlOwner = "NONE";
    this.request.status = "aborted";
    this.touch();
  }

  timeOut(): void {
    this.request.controlOwner = "NONE";
    this.request.status = "timed_out";
    this.touch();
  }

  snapshot(): InterventionRequest {
    const snapshot = structuredClone(this.request);
    const seen = new Set<string>();
    snapshot.humanActions = snapshot.humanActions
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .filter((action) => {
        const key = JSON.stringify({
          type: action.type,
          capture: action.capture,
          role: action.role,
          name: action.name,
          from: action.from,
          to: action.to,
          timestamp: action.timestamp,
        });
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((action, index) => ({ ...action, sequence: index + 1 }));
    return snapshot;
  }

  private touch(): void {
    this.request.updatedAt = new Date().toISOString();
  }
}

function fingerprint(observation: SurfaceObservation): string {
  return createHash("sha256")
    .update(`${observation.url}\n${observation.accessibilitySnapshot}`)
    .digest("hex");
}

function redactUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.search) url.search = "?redacted";
  return url.toString();
}
