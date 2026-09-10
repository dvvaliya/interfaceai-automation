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
    await this.resolveTarget(target).fill(value, { timeout: 5_000 });
  }

  async click(target: SurfaceTarget): Promise<void> {
    await this.resolveTarget(target).click({ timeout: 5_000 });
  }

  async isVisible(target: SurfaceTarget, timeoutMs = 500): Promise<boolean> {
    return this.resolveTarget(target).isVisible({ timeout: timeoutMs });
  }

  async extractText(target: SurfaceTarget): Promise<string> {
    return (await this.resolveTarget(target).innerText({ timeout: 5_000 })).trim();
  }

  async extractTableCell(
    tableTarget: SurfaceTarget,
    rowMatch: { column: string; value: string },
    outputColumn: string,
  ): Promise<string> {
    const table = this.resolveTarget(tableTarget).getByRole("table");
    const headers = (await table.getByRole("columnheader").allInnerTexts()).map((value) =>
      value.trim(),
    );
    const matchColumnIndex = headers.indexOf(rowMatch.column);
    const outputColumnIndex = headers.indexOf(outputColumn);

    if (matchColumnIndex === -1 || outputColumnIndex === -1) {
      throw new Error(
        `Could not find table columns '${rowMatch.column}' and '${outputColumn}'.`,
      );
    }

    const rows = table.getByRole("row");
    for (let index = 1; index < (await rows.count()); index += 1) {
      const cells = (await rows.nth(index).getByRole("cell").allInnerTexts()).map((value) =>
        value.trim(),
      );
      if (cells[matchColumnIndex] === rowMatch.value) {
        const output = cells[outputColumnIndex];
        if (output !== undefined) {
          return output;
        }
      }
    }

    throw new Error(`Could not find a table row where '${rowMatch.column}' is '${rowMatch.value}'.`);
  }

  private resolveTarget(target: SurfaceTarget): Locator {
    switch (target.strategy) {
      case "role":
        return this.page.getByRole(target.role, {
          name: target.name,
          exact: target.exact ?? true,
        });
      case "label":
        return this.page.getByLabel(target.label, { exact: target.exact ?? true });
      case "text":
        return this.page.getByText(target.text, { exact: target.exact ?? true });
    }
  }
}
