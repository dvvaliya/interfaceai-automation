import type { CapabilityArtifact } from "../artifacts/schema.js";
import type { ReplayInputs } from "./inputs.js";

type ArtifactStep = CapabilityArtifact["steps"][number];

export type ResolvedReplayStep =
  | (Omit<Extract<ArtifactStep, { action: "fill" }>, "value"> & { value: string })
  | Extract<ArtifactStep, { action: "click" }>;

export function resolveReplaySteps(
  artifact: CapabilityArtifact,
  inputs: ReplayInputs,
): ResolvedReplayStep[] {
  return artifact.steps.map((step) => {
    if (step.action === "click") {
      return step;
    }

    if (step.value.source === "literal") {
      return { ...step, value: step.value.value };
    }

    const inputValue = inputs[step.value.name];
    if (inputValue === undefined) {
      throw new Error(`No replay value was provided for input '${step.value.name}'.`);
    }

    return { ...step, value: String(inputValue) };
  });
}
