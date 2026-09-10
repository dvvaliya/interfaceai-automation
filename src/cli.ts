#!/usr/bin/env node

import { Command } from "commander";
import { runActionCheck } from "./commands/action-check.js";
import { runBrowserCheck } from "./commands/browser-check.js";
import { runHealthCheck } from "./commands/health.js";
import { runLoginCheck } from "./commands/login-check.js";
import { runObserveCheck } from "./commands/observe-check.js";
import { loadConfig } from "./config/env.js";

const program = new Command();

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
  .command("browser-check")
  .description("Open the bank app and capture a verification screenshot")
  .option("--headed", "show the browser window while checking")
  .action(async (options: { headed?: boolean }) => {
    const config = loadConfig();
    await runBrowserCheck(config, options.headed ?? false);
  });

program
  .command("login-check")
  .description("Log in to the bank app and capture a verification screenshot")
  .option("--headed", "show the browser window while checking")
  .action(async (options: { headed?: boolean }) => {
    const config = loadConfig();
    await runLoginCheck(config, options.headed ?? false);
  });

program
  .command("observe-check")
  .description("Log in and capture an accessibility-based page observation")
  .option("--headed", "show the browser window while checking")
  .action(async (options: { headed?: boolean }) => {
    const config = loadConfig();
    await runObserveCheck(config, options.headed ?? false);
  });

program
  .command("action-check")
  .description("Use generic surface actions to open a member profile")
  .option("--member-id <memberId>", "five-digit member ID", "12345")
  .option("--headed", "show the browser window while checking")
  .action(async (options: { memberId: string; headed?: boolean }) => {
    const config = loadConfig();
    await runActionCheck(config, options.memberId, options.headed ?? false);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  console.error(message);
  process.exitCode = 1;
});
