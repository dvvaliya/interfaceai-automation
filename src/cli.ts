#!/usr/bin/env node

import { Command } from "commander";
import { runBrowserCheck } from "./browser-check.js";
import { loadConfig } from "./config.js";

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

    console.log("Automation configuration is valid.");
    console.table({
      bankAppUrl: config.BANK_APP_URL,
      llmProvider: config.LLM_PROVIDER,
      llmModel: config.LLM_MODEL || "not configured",
      llmApiKey: config.LLM_API_KEY ? "configured" : "not configured",
    });
  });

program
  .command("browser-check")
  .description("Open the bank app and capture a verification screenshot")
  .option("--headed", "show the browser window while checking")
  .action(async (options: { headed?: boolean }) => {
    const config = loadConfig();
    await runBrowserCheck(config, options.headed ?? false);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  console.error(message);
  process.exitCode = 1;
});
