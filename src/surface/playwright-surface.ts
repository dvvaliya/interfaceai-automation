import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import type { ComputerSurface, SurfaceObservation, SurfaceTarget } from "./types.js";

export class PlaywrightSurface implements ComputerSurface {
  constructor(
    private readonly page: Page,
    private readonly evidenceDirectory = path.resolve("evidence"),
  ) {}

  async observe(evidenceName: string): Promise<SurfaceObservation> {
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(evidenceName)) {
      throw new Error("Evidence name may contain only letters, numbers, hyphens, and underscores.");
    }

    await mkdir(this.evidenceDirectory, { recursive: true });

    const screenshotPath = path.join(this.evidenceDirectory, `${evidenceName}.png`);
    const [title, accessibilitySnapshot] = await Promise.all([
      this.page.title(),
      this.page.locator("body").ariaSnapshot(),
      this.page.screenshot({ path: screenshotPath, fullPage: true }),
    ]);

    return {
      url: this.page.url(),
      title,
      accessibilitySnapshot,
      screenshotPath,
      observedAt: new Date().toISOString(),
    };
  }

  async fill(target: SurfaceTarget, value: string): Promise<void> {
    await this.resolveTarget(target).fill(value);
  }

  async click(target: SurfaceTarget): Promise<void> {
    await this.resolveTarget(target).click();
  }

  private resolveTarget(target: SurfaceTarget): Locator {
    return this.page.getByRole(target.role, { name: target.name, exact: true });
  }
}
