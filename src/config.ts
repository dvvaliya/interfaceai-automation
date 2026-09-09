import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  BANK_APP_URL: z.url().default("http://localhost:3000"),
  LLM_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(): AppConfig {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid automation configuration:\n${details}`);
  }

  return result.data;
}
