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
  z
    .array(z.enum(["fill", "click", "complete", "escalate", "business_outcome", "fail"]))
    .min(1),
);

const configSchema = z.object({
  BANK_APP_URL: z.url().default("http://localhost:3000"),
  BANK_OPERATOR_ID: z.string().min(1).optional(),
  BANK_OPERATOR_PASSWORD: z.string().min(1).optional(),
  ALLOWED_ORIGINS: allowedOriginsSchema.default(["http://localhost:3000"]),
  ALLOWED_PATH_PREFIXES: allowedPathPrefixesSchema.default(["/login", "/members"]),
  ALLOWED_ACTIONS: allowedActionsSchema.default([
    "fill",
    "click",
    "complete",
    "escalate",
    "business_outcome",
    "fail",
  ]),
  LLM_PROVIDER: z.literal("litellm").default("litellm"),
  LITELLM_BASE_URL: z.url().optional(),
  LITELLM_API_KEY: z.string().min(1).optional(),
  LITELLM_MODEL: z.string().min(1).optional(),
  DISCOVERY_MAX_STEPS: z.coerce.number().int().min(1).max(50).default(10),
  DISCOVERY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  HANDOFF_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(1_800_000).default(300_000),
  HANDOFF_MAX_RESUME_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
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
