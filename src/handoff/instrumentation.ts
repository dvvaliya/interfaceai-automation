import type { BrowserContext } from "playwright";
import { humanActionBufferScript } from "../surface/human-action-buffer.js";
import type { HandoffController } from "./controller.js";
import type { CapturedHumanAction } from "./types.js";

export async function installHumanActionCapture(
  context: BrowserContext,
  getController: () => HandoffController | undefined,
): Promise<void> {
  await context.exposeBinding(
    "__interfaceAiRecordHumanAction",
    (_source, action: CapturedHumanAction) => getController()?.recordHumanAction(action),
  );

  context.on("request", (request) => {
    if (!request.isNavigationRequest()) return;
    const frame = request.frame();
    if (frame !== frame.page().mainFrame()) return;
    getController()?.recordHumanAction({
      type: "navigation",
      capture: "exact",
      role: "document",
      name: "Main document navigation",
      from: redactNavigationUrl(frame.url()),
      to: redactNavigationUrl(request.url()),
      timestamp: new Date().toISOString(),
    });
  });

  await context.addInitScript({ content: humanActionBufferScript });
}

function redactNavigationUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.search) url.search = "?redacted";
    return url.toString().slice(0, 120);
  } catch {
    return "invalid-url";
  }
}
