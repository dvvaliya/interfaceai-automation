import type { AppConfig } from "../config/env.js";

export function runHealthCheck(config: AppConfig): void {
  console.log("Automation configuration is valid.");
  console.table({
    bankAppUrl: config.BANK_APP_URL,
    allowedOrigins: config.ALLOWED_ORIGINS.join(", "),
    allowedPaths: config.ALLOWED_PATH_PREFIXES.join(", "),
    allowedActions: config.ALLOWED_ACTIONS.join(", "),
    llmProvider: config.LLM_PROVIDER,
    llmBaseUrl: config.LITELLM_BASE_URL || "not configured",
    llmModel: config.LITELLM_MODEL || "not configured",
    llmApiKey: config.LITELLM_API_KEY ? "configured" : "not configured",
    discoveryMaxSteps: config.DISCOVERY_MAX_STEPS,
    discoveryTimeoutMs: config.DISCOVERY_TIMEOUT_MS,
  });
}
