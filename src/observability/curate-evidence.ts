import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { evidenceRoot } from "./paths.js";
import { redactData } from "./redact.js";

type Selection = {
  label: string;
  kind: "discovery" | "replay";
  runId: string;
  status: string;
  description: string;
};

type EvidenceData = {
  result?: { status?: string; code?: string };
  artifactPath?: string;
};

type LoadedRun = { runId: string; data: EvidenceData; hasHandoff: boolean };

const finalDirectory = path.join(evidenceRoot, "final");

async function main(): Promise<void> {
  const discoveryRuns = await loadRuns("discovery");
  const replayRuns = await loadRuns("replay");

  const selections: Selection[] = [
    selectRun(discoveryRuns, "discovery-success", "completed", "Real LiteLLM discovery run"),
    selectRun(replayRuns, "replay-success", "success", "Deterministic replay without an LLM"),
    selectRun(
      replayRuns,
      "replay-business-outcome",
      "business_outcome",
      "Expected member-not-found business outcome",
      "MEMBER_NOT_FOUND",
    ),
    selectRun(
      replayRuns,
      "replay-hard-failure",
      "failure",
      "Application-error replay failure",
      "APPLICATION_ERROR",
    ),
    selectRun(
      replayRuns,
      "replay-recoverable-failure",
      "failure",
      "Session-expired bounded recovery attempt",
      "SESSION_EXPIRED",
    ),
    selectHandoffRun(discoveryRuns),
  ];

  await rm(finalDirectory, { recursive: true, force: true });
  await mkdir(finalDirectory, { recursive: true });

  for (const selection of selections) {
    const source = path.join(evidenceRoot, selection.kind, selection.runId);
    const destination = path.join(finalDirectory, selection.label);
    await cp(source, destination, { recursive: true });
    await sanitizeDirectory(destination, `evidence/final/${selection.label}`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    runs: selections,
  };
  await writeFile(
    path.join(finalDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(`Curated evidence written to ${finalDirectory}`);
}

async function loadRuns(
  kind: "discovery" | "replay",
): Promise<LoadedRun[]> {
  const directory = path.join(evidenceRoot, kind);
  const entries = await readdir(directory, { withFileTypes: true });
  const runs: LoadedRun[] = [];

  for (const entry of entries.filter((item) => item.isDirectory()).sort().reverse()) {
    try {
      const raw = await readFile(path.join(directory, entry.name, "result.json"), "utf8");
      const childEntries = await readdir(path.join(directory, entry.name), { withFileTypes: true });
      runs.push({
        runId: entry.name,
        data: JSON.parse(raw) as EvidenceData,
        hasHandoff: childEntries.some((child) => child.isDirectory() && child.name === "handoff"),
      });
    } catch {
      // Ignore incomplete development runs.
    }
  }
  return runs;
}

function selectRun(
  runs: LoadedRun[],
  label: string,
  status: string,
  description: string,
  code?: string,
): Selection {
  const match = runs.find(
    (run) => run.data?.result?.status === status && (!code || run.data.result.code === code),
  );
  if (!match) throw new Error(`No '${status}' evidence run is available for ${label}.`);
  return {
    label,
    kind: label.startsWith("discovery") ? "discovery" : "replay",
    runId: match.runId,
    status,
    description,
  };
}

function selectHandoffRun(runs: LoadedRun[]): Selection {
  const match = runs.find(
    (run) => run.data?.result?.status === "completed" && run.hasHandoff,
  );
  if (!match) throw new Error("No completed human-handoff discovery run is available.");
  return {
    label: "human-handoff",
    kind: "discovery",
    runId: match.runId,
    status: "completed",
    description: "Same-session human takeover and resume",
  };
}

async function sanitizeDirectory(directory: string, finalRelativePath: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const redactionValues = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile() || !/\.(json|jsonl)$/.test(entry.name)) continue;
    const contents = await readFile(path.join(directory, entry.name), "utf8");
    collectSensitiveCandidates(contents).forEach((value) => redactionValues.add(value));
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await sanitizeDirectory(entryPath, finalRelativePath);
      continue;
    }
    if (entry.name.endsWith(".json")) {
      const parsed = JSON.parse(await readFile(entryPath, "utf8"));
      const sanitized = rewritePaths(redactData(parsed, [...redactionValues]), finalRelativePath);
      await writeFile(
        entryPath,
        `${JSON.stringify(sanitized, null, 2)}\n`,
        "utf8",
      );
    } else if (entry.name.endsWith(".jsonl")) {
      const lines = (await readFile(entryPath, "utf8")).trim().split("\n").filter(Boolean);
      const sanitized = lines.map((line) =>
        JSON.stringify(
          rewritePaths(redactData(JSON.parse(line), [...redactionValues]), finalRelativePath),
        ),
      );
      await writeFile(entryPath, `${sanitized.join("\n")}\n`, "utf8");
    }
  }
}

function rewritePaths(value: unknown, finalRelativePath: string): unknown {
  if (typeof value === "string") {
    return value
      .replace(
        /^.*\/evidence\/(?:discovery|replay)\/[^/]+/,
        finalRelativePath,
      )
      .replace(/^evidence\/(?:discovery|replay)\/[^/]+/, finalRelativePath)
      .replace(/^.*\/artifacts\//, "artifacts/");
  }
  if (Array.isArray(value)) return value.map((item) => rewritePaths(item, finalRelativePath));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        rewritePaths(child, finalRelativePath),
      ]),
    );
  }
  return value;
}

function collectSensitiveCandidates(contents: string): string[] {
  return [
    ...(contents.match(/\b\d{5}\b/g) ?? []),
    ...(contents.match(/\$\d[\d,]*\.\d{2}/g) ?? []),
    ...(contents.match(/\b(?:SAV|CHK)-\*{4}-\d{4}\b/g) ?? []),
    ...(contents.match(/(?<=Member \[?REDACTED_VALUE\]? \()[A-Z][a-z]+ [A-Z][A-Za-z'-]+/g) ?? []),
  ];
}

await main();
