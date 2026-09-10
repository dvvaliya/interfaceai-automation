import { z } from "zod";

const targetNameSchema = z.string().trim().min(1).max(120);
const reasonSchema = z.string().trim().min(1).max(500);

export const fillActionSchema = z
  .object({
    type: z.literal("fill"),
    target: z
      .object({
        strategy: z.literal("role"),
        role: z.literal("textbox"),
        name: targetNameSchema,
      })
      .strict(),
    value: z.string().min(1).max(500),
    reason: reasonSchema,
  })
  .strict();

export const clickActionSchema = z
  .object({
    type: z.literal("click"),
    target: z
      .object({
        strategy: z.literal("role"),
        role: z.enum(["button", "link"]),
        name: targetNameSchema,
      })
      .strict(),
    reason: reasonSchema,
  })
  .strict();

export const completeActionSchema = z
  .object({
    type: z.literal("complete"),
    summary: z.string().trim().min(1).max(1_000),
    outputs: z.record(z.string().trim().min(1).max(120), z.string().max(1_000)),
    reason: reasonSchema,
  })
  .strict();

export const escalateActionSchema = z
  .object({
    type: z.literal("escalate"),
    reason: reasonSchema,
  })
  .strict();

export const businessOutcomeActionSchema = z
  .object({
    type: z.literal("business_outcome"),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().trim().min(1).max(1_000),
    reason: reasonSchema,
  })
  .strict();

export const failActionSchema = z
  .object({
    type: z.literal("fail"),
    category: z.enum(["recoverable", "hard"]),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().trim().min(1).max(1_000),
    reason: reasonSchema,
  })
  .strict();

export const agentActionSchema = z.discriminatedUnion("type", [
  fillActionSchema,
  clickActionSchema,
  completeActionSchema,
  escalateActionSchema,
  businessOutcomeActionSchema,
  failActionSchema,
]);

export type AgentAction = z.infer<typeof agentActionSchema>;

export function parseAgentAction(input: unknown): AgentAction {
  return agentActionSchema.parse(input);
}
