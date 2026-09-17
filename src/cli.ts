#!/usr/bin/env node

import { Command } from "commander";
import { runDiscover } from "./commands/discover.js";
import { runHealthCheck } from "./commands/health.js";
import { runReplay } from "./commands/replay.js";
import { loadConfig } from "./config/env.js";

const program = new Command();

function collectInput(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program
  .name("interfaceai-automation")
  .description("Discover and replay browser capabilities safely")
  .version("0.1.0");

program
  .command("health")
  .description("Validate local configuration without starting a browser")
  .action(() => {
    const config = loadConfig();
    runHealthCheck(config);
  });

program
  .command("discover")
  .description("Accept a natural-language goal and target application")
  .requiredOption("-g, --goal <goal>", "goal for the discovery run")
  .option("-t, --target <url>", "target application URL")
  .option("--headless", "run without a visible browser or local human takeover")
  .action(async (options: { goal: string; target?: string; headless?: boolean }) => {
    const config = loadConfig();
    await runDiscover(config, options.goal, options.target, options.headless ?? false);
  });

program
  .command("replay")
  .description("Replay a capability artifact without an LLM")
  .requiredOption("-a, --artifact <path>", "path to a capability artifact")
  .option("-i, --input <key=value>", "typed replay input (repeatable)", collectInput, [])
  .option("--headless", "run without a visible browser or local human takeover")
  .action(async (options: { artifact: string; input: string[]; headless?: boolean }) => {
    const config = loadConfig();
    await runReplay(config, options.artifact, options.input, options.headless ?? false);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  console.error(message);
  process.exitCode = 1;
});
