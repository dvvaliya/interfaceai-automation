import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = path.resolve(moduleDirectory, "../../..");
export const evidenceRoot = path.join(repositoryRoot, "evidence");
export const artifactsRoot = path.join(repositoryRoot, "artifacts");
