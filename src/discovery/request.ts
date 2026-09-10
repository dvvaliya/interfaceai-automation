import { z } from "zod";

export const discoveryRequestSchema = z
  .object({
    goal: z.string().trim().min(1, "Goal is required.").max(1_000),
    target: z.url("Target must be a valid URL."),
  })
  .strict();

export type DiscoveryRequest = z.infer<typeof discoveryRequestSchema>;

export function parseDiscoveryRequest(input: unknown): DiscoveryRequest {
  return discoveryRequestSchema.parse(input);
}
