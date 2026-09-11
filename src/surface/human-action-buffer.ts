export const humanActionBufferScript = `(() => {
  if (window.__interfaceAiHumanCaptureInstalled) return;
  window.__interfaceAiHumanCaptureInstalled = true;

  function describeElement(element) {
    const tagName = element.tagName.toLowerCase();
    const implicitRole =
      tagName === "a" ? "link" :
      tagName === "button" ? "button" :
      tagName === "select" ? "combobox" :
      tagName === "input" || tagName === "textarea" ? "textbox" : tagName;
    return {
      role: element.getAttribute("role") || implicitRole,
      name: (
        element.getAttribute("aria-label") ||
        (element.labels && element.labels[0] && element.labels[0].textContent) ||
        element.innerText ||
        element.getAttribute("name") ||
        "unnamed"
      ).trim().slice(0, 120),
    };
  }

  async function report(type, event) {
    if (!(event.target instanceof Element)) return;
    if (localStorage.getItem("__interfaceAiHumanControl") !== "true") return;

    const control = event.target.closest("button, a, input, select, textarea, [role]") || event.target;
    const action = {
      ...describeElement(control),
      type,
      capture: "exact",
      timestamp: new Date().toISOString(),
    };
    let actions = [];
    try {
      actions = JSON.parse(localStorage.getItem("__interfaceAiHumanActions") || "[]");
    } catch {}
    actions.push(action);
    localStorage.setItem("__interfaceAiHumanActions", JSON.stringify(actions));

    if (control.tagName.toLowerCase() === "a" && control.href && window.__interfaceAiRecordHumanAction) {
      event.preventDefault();
      await window.__interfaceAiRecordHumanAction(action);
      window.location.assign(control.href);
    }
  }

  document.addEventListener("click", (event) => { void report("click", event); }, true);
  document.addEventListener("change", (event) => { void report("change", event); }, true);
})()`;
