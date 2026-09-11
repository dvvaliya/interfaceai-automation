import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evidenceRoot } from "../observability/paths.js";
import { redactData } from "../observability/redact.js";
import type { InterventionRequest } from "./types.js";

export async function saveIntervention(
  request: InterventionRequest,
  directory = path.join(evidenceRoot, "handoff"),
  redactionValues: readonly string[] = [],
): Promise<string> {
  await mkdir(directory, { recursive: true });

  const requestPath = path.join(directory, "intervention-request.json");
  const actionsPath = path.join(directory, "human-actions.json");
  const redactedRequest = redactData(request, redactionValues);
  const redactedActions = redactData(request.humanActions, redactionValues);
  await Promise.all([
    writeFile(requestPath, `${JSON.stringify(redactedRequest, null, 2)}\n`, "utf8"),
    writeFile(actionsPath, `${JSON.stringify(redactedActions, null, 2)}\n`, "utf8"),
  ]);
  return requestPath;
}
