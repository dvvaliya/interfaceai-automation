import type { BrowserContext } from "playwright";
import type { HandoffController } from "./controller.js";

export async function installHumanActionCapture(
  context: BrowserContext,
  getController: () => HandoffController | undefined,
): Promise<void> {
  context.on("request", (request) => {
    if (!request.isNavigationRequest()) return;
    getController()?.recordHumanAction({
      type: "navigation",
      role: "document",
      name: redactNavigationUrl(request.url()),
      timestamp: new Date().toISOString(),
    });
  });

  await context.addInitScript(() => {
    const describeElement = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const labelledElement = element as HTMLInputElement;
      const tagName = element.tagName.toLowerCase();
      const implicitRole =
        tagName === "a"
          ? "link"
          : tagName === "button"
            ? "button"
            : tagName === "select"
              ? "combobox"
              : tagName === "input" || tagName === "textarea"
                ? "textbox"
                : tagName;
      return {
        role: element.getAttribute("role") || implicitRole,
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
      if (sessionStorage.getItem("__interfaceAiHumanControl") !== "true") return;

      const control = event.target.closest("button, a, input, select, textarea, [role]") ?? event.target;
      const details = describeElement(control);
      const actions = JSON.parse(
        sessionStorage.getItem("__interfaceAiHumanActions") ?? "[]",
      ) as Array<Record<string, string>>;
      actions.push({ ...details, type, timestamp: new Date().toISOString() });
      sessionStorage.setItem("__interfaceAiHumanActions", JSON.stringify(actions));
    };

    document.addEventListener("click", (event) => report("click", event), true);
    document.addEventListener("change", (event) => report("change", event), true);
  });
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
