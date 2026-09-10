import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCapabilityArtifact, type CapabilityArtifact } from "./schema.js";

export async function loadCapabilityArtifact(filePath: string): Promise<CapabilityArtifact> {
  const resolvedPath = path.resolve(filePath);
  let contents: string;

  try {
    contents = await readFile(resolvedPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown file error";
    throw new Error(`Could not read artifact '${resolvedPath}': ${message}`);
  }

  try {
    return parseCapabilityArtifact(JSON.parse(contents));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validation error";
    throw new Error(`Artifact '${resolvedPath}' is invalid: ${message}`);
  }
}
