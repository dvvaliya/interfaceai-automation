import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InterventionRequest } from "./types.js";

export async function saveIntervention(request: InterventionRequest): Promise<string> {
  const directory = path.resolve("evidence");
  await mkdir(directory, { recursive: true });

  const requestPath = path.join(directory, "intervention-request.json");
  const actionsPath = path.join(directory, "human-actions.json");
  await Promise.all([
    writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8"),
    writeFile(actionsPath, `${JSON.stringify(request.humanActions, null, 2)}\n`, "utf8"),
  ]);
  return requestPath;
}
