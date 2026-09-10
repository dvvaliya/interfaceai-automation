import type { BrowserContext } from "playwright";
import type { HandoffController } from "./controller.js";
import type { HumanActionEvent } from "./types.js";

export async function installHumanActionCapture(
  context: BrowserContext,
  getController: () => HandoffController | undefined,
): Promise<void> {
  await context.exposeBinding(
    "__interfaceAiRecordHumanAction",
    (_source, event: HumanActionEvent) => getController()?.recordHumanAction(event),
  );

  await context.addInitScript(() => {
    const describeElement = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const labelledElement = element as HTMLInputElement;
      return {
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        name: (
          element.getAttribute("aria-label") ||
          labelledElement.labels?.[0]?.textContent ||
          htmlElement.innerText ||
          element.getAttribute("name") ||
          "unnamed"
        )
          .trim()
          .slice(0, 120),
      };
    };

    const report = (type: "click" | "change", event: Event) => {
      if (!(event.target instanceof Element)) return;
      const details = describeElement(event.target);
      const recorder = (
        window as unknown as {
          __interfaceAiRecordHumanAction?: (action: HumanActionEvent) => Promise<void>;
        }
      ).__interfaceAiRecordHumanAction;
      void recorder?.({ ...details, type, timestamp: new Date().toISOString() });
    };

    document.addEventListener("click", (event) => report("click", event), true);
    document.addEventListener("change", (event) => report("change", event), true);
  });
}
