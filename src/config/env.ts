import "dotenv/config";
import { z } from "zod";

const commaSeparatedValues = z.string().transform((value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const allowedOriginsSchema = commaSeparatedValues
  .pipe(z.array(z.url()).min(1))
  .transform((urls) => [...new Set(urls.map((url) => new URL(url).origin))]);

const allowedPathPrefixesSchema = commaSeparatedValues.pipe(
  z.array(z.string().startsWith("/")).min(1),
);

const allowedActionsSchema = commaSeparatedValues.pipe(
  z.array(z.enum(["fill", "click", "complete", "escalate"])).min(1),
);

const configSchema = z.object({
  BANK_APP_URL: z.url().default("http://localhost:3000"),
  BANK_OPERATOR_ID: z.string().min(1).optional(),
  BANK_OPERATOR_PASSWORD: z.string().min(1).optional(),
  ALLOWED_ORIGINS: allowedOriginsSchema.default(["http://localhost:3000"]),
  ALLOWED_PATH_PREFIXES: allowedPathPrefixesSchema.default(["/login", "/members"]),
  ALLOWED_ACTIONS: allowedActionsSchema.default(["fill", "click", "complete", "escalate"]),
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
