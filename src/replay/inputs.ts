import type { CapabilityArtifact } from "../artifacts/schema.js";

export type ReplayInputValue = string | number | boolean;
export type ReplayInputs = Record<string, ReplayInputValue>;

export function resolveReplayInputs(
  definitions: CapabilityArtifact["inputs"],
  assignments: readonly string[],
): ReplayInputs {
  const rawInputs: Record<string, string> = {};

  for (const assignment of assignments) {
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === assignment.length - 1) {
      throw new Error(`Invalid input '${assignment}'. Expected key=value.`);
    }

    const name = assignment.slice(0, separatorIndex).trim();
    const value = assignment.slice(separatorIndex + 1).trim();
    if (!(name in definitions)) {
      throw new Error(`Unknown artifact input '${name}'.`);
    }
    if (name in rawInputs) {
      throw new Error(`Duplicate artifact input '${name}'.`);
    }
    rawInputs[name] = value;
  }

  const resolved: ReplayInputs = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const rawValue = rawInputs[name];
    if (rawValue === undefined) {
      if (definition.required) {
        throw new Error(`Missing required artifact input '${name}'.`);
      }
      continue;
    }

    if (definition.type === "string") {
      if (definition.pattern) {
        let pattern: RegExp;
        try {
          pattern = new RegExp(definition.pattern);
        } catch {
          throw new Error(`Artifact input '${name}' contains an invalid pattern.`);
        }
        if (!pattern.test(rawValue)) {
          throw new Error(`Input '${name}' does not match ${definition.pattern}.`);
        }
      }
      resolved[name] = rawValue;
      continue;
    }

    if (definition.type === "number") {
      const numberValue = Number(rawValue);
      if (!Number.isFinite(numberValue)) {
        throw new Error(`Input '${name}' must be a number.`);
      }
      if (definition.minimum !== undefined && numberValue < definition.minimum) {
        throw new Error(`Input '${name}' must be at least ${definition.minimum}.`);
      }
      if (definition.maximum !== undefined && numberValue > definition.maximum) {
        throw new Error(`Input '${name}' must be at most ${definition.maximum}.`);
      }
      resolved[name] = numberValue;
      continue;
    }

    if (rawValue !== "true" && rawValue !== "false") {
      throw new Error(`Input '${name}' must be true or false.`);
    }
    resolved[name] = rawValue === "true";
  }

  return resolved;
}
