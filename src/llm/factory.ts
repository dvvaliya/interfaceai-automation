import type { AppConfig } from "../config/env.js";
import { LiteLlmProvider } from "./litellm-provider.js";
import type { LlmProvider } from "./provider.js";

export function createLlmProvider(config: AppConfig): LlmProvider {
  if (!config.LITELLM_BASE_URL || !config.LITELLM_API_KEY || !config.LITELLM_MODEL) {
    throw new Error(
      "LITELLM_BASE_URL, LITELLM_API_KEY, and LITELLM_MODEL must be configured for discovery.",
    );
  }

  return new LiteLlmProvider({
    baseUrl: config.LITELLM_BASE_URL,
    apiKey: config.LITELLM_API_KEY,
    model: config.LITELLM_MODEL,
  });
}
