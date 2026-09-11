import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { HandoffController } from "../../src/handoff/controller.js";
import { installHumanActionCapture } from "../../src/handoff/instrumentation.js";
import { PlaywrightSurface } from "../../src/surface/playwright-surface.js";

describe("human action instrumentation", () => {
  let browser: Browser;
  let context: BrowserContext;
  let baseUrl: string;
  let evidenceDirectory: string;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    if (request.url === "/next") {
      response.end("<!doctype html><html><body><h1>Member Profile</h1></body></html>");
      return;
    }
    response.end(
      '<!doctype html><html><body><a href="/next">Continue and record access</a></body></html>',
    );
  });

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    evidenceDirectory = await mkdtemp(path.join(os.tmpdir(), "interfaceai-handoff-"));
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
  });

  after(async () => {
    await context.close();
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(evidenceDirectory, { recursive: true, force: true });
  });

  it("records the exact clicked link before navigation replaces the page", async () => {
    let controller: HandoffController | undefined;
    await installHumanActionCapture(context, () => controller);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(baseUrl);
    const surface = new PlaywrightSurface(page, evidenceDirectory);
    const observation = await surface.observe("before");
    controller = new HandoffController({
      capabilityId: "test_capability",
      stepId: "restricted_access",
      reason: "Human approval required.",
      blockerText: "Restricted Record Warning",
      observation,
    });
    controller.cedeToHuman();
    await surface.beginHumanControl();
    assert.deepEqual(
      await page.evaluate(() => ({
        installed: Boolean(
          (window as typeof window & { __interfaceAiHumanCaptureInstalled?: boolean })
            .__interfaceAiHumanCaptureInstalled,
        ),
        active: localStorage.getItem("__interfaceAiHumanControl"),
      })),
      { installed: true, active: "true" },
    );

    await page.getByRole("link", { name: "Continue and record access" }).click();
    await page.waitForURL(`${baseUrl}/next`);
    const bufferedActions = await surface.endHumanControl();
    bufferedActions.forEach((action) => controller?.recordHumanAction(action));

    const actions = controller.snapshot().humanActions;
    assert.equal(
      actions.some(
        (action) =>
          action.type === "click" &&
          action.capture === "exact" &&
          action.role === "link" &&
          action.name === "Continue and record access",
      ),
      true,
      JSON.stringify({ actions, pageErrors }, null, 2),
    );
    assert.equal(
      actions.some(
        (action) => action.type === "navigation" && action.to?.endsWith("/next"),
      ),
      true,
    );
    assert.deepEqual(
      actions.map((action) => action.sequence),
      actions.map((_, index) => index + 1),
    );
  });
});
