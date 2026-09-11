import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { artifactsRoot, evidenceRoot } from "../observability/paths.js";
import {
  parseCapabilityArtifact,
  type CapabilityArtifact,
} from "./schema.js";

export async function saveCapabilityArtifact(
  artifactInput: CapabilityArtifact,
  directory = artifactsRoot,
): Promise<string> {
  const artifact = parseCapabilityArtifact(artifactInput);
  await mkdir(directory, { recursive: true });

  const artifactPath = path.join(directory, `${artifact.id}.json`);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
}

export async function saveExampleArtifact(artifactInput: CapabilityArtifact): Promise<string> {
  const artifact = parseCapabilityArtifact(artifactInput);
  await mkdir(evidenceRoot, { recursive: true });

  const artifactPath = path.join(evidenceRoot, "example-artifact.json");
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
}
