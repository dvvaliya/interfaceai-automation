import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { evidenceRoot } from "./paths.js";
import { redactData } from "./redact.js";

export type RunKind = "discovery" | "replay" | "check";

export class RunEvidence {
  readonly runId: string;
  readonly directory: string;
  readonly screenshotsDirectory: string;
  readonly logPath: string;
  private pendingWrite: Promise<void> = Promise.resolve();

  private constructor(
    readonly kind: RunKind,
    runId: string,
    rootDirectory: string,
    private readonly redactionValues: Set<string>,
  ) {
    this.runId = runId;
    this.directory = path.join(rootDirectory, kind, runId);
    this.screenshotsDirectory = path.join(this.directory, "screenshots");
    this.logPath = path.join(this.directory, "run.jsonl");
  }

  static async create(
    kind: RunKind,
    options: {
      rootDirectory?: string;
      runId?: string;
      redactionValues?: readonly string[];
    } = {},
  ): Promise<RunEvidence> {
    const run = new RunEvidence(
      kind,
      options.runId ?? createRunId(),
      options.rootDirectory ?? evidenceRoot,
      new Set(options.redactionValues ?? []),
    );
    await mkdir(run.screenshotsDirectory, { recursive: true });
    return run;
  }

  record(event: string, data: unknown = {}): void {
    const entry = redactData(
      {
        timestamp: new Date().toISOString(),
        runId: this.runId,
        kind: this.kind,
        event,
        data,
      },
      [...this.redactionValues],
    );
    this.pendingWrite = this.pendingWrite.then(() =>
      appendFile(this.logPath, `${JSON.stringify(entry)}\n`, "utf8"),
    );
  }

  async writeJson(fileName: string, data: unknown): Promise<string> {
    assertSafeFileName(fileName);
    await this.flush();
    const filePath = path.join(this.directory, fileName);
    await writeFile(
      filePath,
      `${JSON.stringify(redactData(data, [...this.redactionValues]), null, 2)}\n`,
      "utf8",
    );
    return filePath;
  }

  async flush(): Promise<void> {
    await this.pendingWrite;
  }

  addRedactionValues(values: readonly unknown[]): void {
    for (const value of values) {
      if (typeof value === "string" && value) this.redactionValues.add(value);
    }
  }
}

function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

function assertSafeFileName(fileName: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(fileName)) {
    throw new Error("Evidence file name contains unsupported characters.");
  }
}
