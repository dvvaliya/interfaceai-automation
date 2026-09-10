import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseCapabilityArtifact,
  type CapabilityArtifact,
} from "./schema.js";

export async function saveCapabilityArtifact(
  artifactInput: CapabilityArtifact,
  directory = path.resolve(process.cwd(), "..", "artifacts"),
): Promise<string> {
  const artifact = parseCapabilityArtifact(artifactInput);
  await mkdir(directory, { recursive: true });

  const artifactPath = path.join(directory, `${artifact.id}.json`);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
}
