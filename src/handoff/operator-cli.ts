import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { evaluateLocationPolicy, type ActionPolicy } from "../policy/action-policy.js";
import type { ComputerSurface } from "../surface/types.js";
import type { HandoffController } from "./controller.js";
import { saveIntervention } from "./store.js";

export type OperatorDecision = "resume" | "complete" | "abort" | "timeout";

export async function runOperatorHandoff(options: {
  controller: HandoffController;
  surface: ComputerSurface;
  policy: ActionPolicy;
  blockerText?: string;
  cancelledText?: string;
  timeoutMs: number;
  maxResumeAttempts: number;
  evidenceDirectory?: string;
  redactionValues?: readonly string[];
}): Promise<OperatorDecision> {
  options.controller.cedeToHuman();
  await options.surface.beginHumanControl();
  const requestPath = await saveIntervention(
    options.controller.snapshot(),
    options.evidenceDirectory,
    options.redactionValues,
  );
  const readline = createInterface({ input, output });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), options.timeoutMs);

  console.log("\nHuman intervention required.");
  console.log(`Reason: ${options.controller.snapshot().reason}`);
  console.log(`Request: ${requestPath}`);
  console.log("Operate the open Chromium window, then return here.");

  try {
    for (let attempt = 1; attempt <= options.maxResumeAttempts; attempt += 1) {
      const answer = (
        await readline.question("[r] Resume  [c] Validate completed  [a] Abort: ", {
          signal: abortController.signal,
        })
      )
        .trim()
        .toLowerCase();

      const humanActions = await options.surface.endHumanControl();
      for (const action of humanActions) options.controller.recordHumanAction(action);

      if (answer === "a") {
        options.controller.abort();
        await saveIntervention(
          options.controller.snapshot(),
          options.evidenceDirectory,
          options.redactionValues,
        );
        return "abort";
      }

      if (answer !== "r" && answer !== "c") {
        console.log("Enter r, c, or a.");
        await options.surface.beginHumanControl();
        continue;
      }

      const observation = await options.surface.observe(`handoff-after-${attempt}`);
      const cancelled = options.cancelledText
        ? await options.surface.isVisible(
            { strategy: "text", text: options.cancelledText, exact: true },
            300,
          )
        : false;
      if (cancelled) {
        options.controller.abort();
        await saveIntervention(
          options.controller.snapshot(),
          options.evidenceDirectory,
          options.redactionValues,
        );
        console.log("The human cancelled the protected operation. The run will stop.");
        return "abort";
      }

      const blockerVisible = options.blockerText
        ? await options.surface.isVisible(
            { strategy: "text", text: options.blockerText, exact: true },
            300,
          )
        : false;
      const locationAllowed =
        evaluateLocationPolicy(options.policy, observation.url).effect === "allow";
      const resume = options.controller.tryResume({
        observation,
        blockerVisible,
        locationAllowed,
      });
      await saveIntervention(
        options.controller.snapshot(),
        options.evidenceDirectory,
        options.redactionValues,
      );

      if (!resume.resumed) {
        console.log(`Cannot resume: ${resume.reason}`);
        await options.surface.beginHumanControl();
        continue;
      }

      await saveIntervention(
        options.controller.snapshot(),
        options.evidenceDirectory,
        options.redactionValues,
      );
      return answer === "c" ? "complete" : "resume";
    }

    options.controller.abort();
    await saveIntervention(
      options.controller.snapshot(),
      options.evidenceDirectory,
      options.redactionValues,
    );
    return "abort";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      options.controller.timeOut();
      await saveIntervention(
        options.controller.snapshot(),
        options.evidenceDirectory,
        options.redactionValues,
      );
      return "timeout";
    }
    if (error instanceof Error && error.message === "readline was closed") {
      options.controller.abort();
      await saveIntervention(
        options.controller.snapshot(),
        options.evidenceDirectory,
        options.redactionValues,
      );
      return "abort";
    }
    throw error;
  } finally {
    clearTimeout(timer);
    readline.close();
  }
}
