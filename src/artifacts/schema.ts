import { z } from "zod";

const identifierSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const fieldNameSchema = z.string().regex(/^[a-z][A-Za-z0-9_]*$/);
const semanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const nonEmptyTextSchema = z.string().trim().min(1);

export const roleLocatorSchema = z
  .object({
    strategy: z.literal("role"),
    role: z.enum([
      "button",
      "cell",
      "combobox",
      "heading",
      "link",
      "region",
      "row",
      "textbox",
    ]),
    name: nonEmptyTextSchema.max(200),
    exact: z.boolean().default(true),
  })
  .strict();

export const labelLocatorSchema = z
  .object({
    strategy: z.literal("label"),
    label: nonEmptyTextSchema.max(200),
    exact: z.boolean().default(true),
  })
  .strict();

export const textLocatorSchema = z
  .object({
    strategy: z.literal("text"),
    text: nonEmptyTextSchema.max(500),
    exact: z.boolean().default(true),
  })
  .strict();

export const locatorSchema = z.discriminatedUnion("strategy", [
  roleLocatorSchema,
  labelLocatorSchema,
  textLocatorSchema,
]);

export const locatorPlanSchema = z
  .object({
    primary: locatorSchema,
    fallbacks: z.array(locatorSchema).max(3).default([]),
    rationale: nonEmptyTextSchema.max(500),
  })
  .strict();

const stringInputSchema = z
  .object({
    type: z.literal("string"),
    description: nonEmptyTextSchema.max(500),
    required: z.boolean().default(true),
    sensitive: z.boolean().default(false),
    pattern: z.string().optional(),
  })
  .strict();

const numberInputSchema = z
  .object({
    type: z.literal("number"),
    description: nonEmptyTextSchema.max(500),
    required: z.boolean().default(true),
    sensitive: z.boolean().default(false),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  })
  .strict();

const booleanInputSchema = z
  .object({
    type: z.literal("boolean"),
    description: nonEmptyTextSchema.max(500),
    required: z.boolean().default(true),
    sensitive: z.boolean().default(false),
  })
  .strict();

export const inputDefinitionSchema = z.discriminatedUnion("type", [
  stringInputSchema,
  numberInputSchema,
  booleanInputSchema,
]);

const inputValueSchema = z
  .object({
    source: z.literal("input"),
    name: fieldNameSchema,
  })
  .strict();

const literalValueSchema = z
  .object({
    source: z.literal("literal"),
    value: z.string().max(500),
  })
  .strict();

export const stepValueSchema = z.discriminatedUnion("source", [
  inputValueSchema,
  literalValueSchema,
]);

const stepBase = {
  id: identifierSchema,
  description: nonEmptyTextSchema.max(500),
  risk: z.enum(["safe", "reversible", "risky"]),
};

export const fillStepSchema = z
  .object({
    ...stepBase,
    action: z.literal("fill"),
    target: locatorPlanSchema,
    value: stepValueSchema,
  })
  .strict();

export const clickStepSchema = z
  .object({
    ...stepBase,
    action: z.literal("click"),
    target: locatorPlanSchema,
  })
  .strict();

export const artifactStepSchema = z.discriminatedUnion("action", [
  fillStepSchema,
  clickStepSchema,
]);

const textOutputSourceSchema = z
  .object({
    kind: z.literal("text"),
    target: locatorPlanSchema,
  })
  .strict();

const tableCellOutputSourceSchema = z
  .object({
    kind: z.literal("table_cell"),
    table: locatorPlanSchema,
    rowMatch: z
      .object({
        column: nonEmptyTextSchema.max(200),
        value: nonEmptyTextSchema.max(500),
      })
      .strict(),
    column: nonEmptyTextSchema.max(200),
  })
  .strict();

export const outputDefinitionSchema = z
  .object({
    type: z.enum(["string", "number", "boolean"]),
    description: nonEmptyTextSchema.max(500),
    required: z.boolean().default(true),
    source: z.discriminatedUnion("kind", [textOutputSourceSchema, tableCellOutputSourceSchema]),
  })
  .strict();

const visibleCheckpointSchema = z
  .object({
    kind: z.literal("visible"),
    target: locatorPlanSchema,
  })
  .strict();

const urlCheckpointSchema = z
  .object({
    kind: z.literal("url_matches"),
    pattern: nonEmptyTextSchema.max(500),
  })
  .strict();

export const checkpointSchema = z.discriminatedUnion("kind", [
  visibleCheckpointSchema,
  urlCheckpointSchema,
]);

export const knownOutcomeSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    classification: z.enum(["business", "recoverable", "intervention", "failure"]),
    description: nonEmptyTextSchema.max(500),
    whenTextVisible: nonEmptyTextSchema.max(500),
  })
  .strict();

export const capabilityArtifactSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    capabilityVersion: semanticVersionSchema,
    id: identifierSchema,
    name: nonEmptyTextSchema.max(120),
    description: nonEmptyTextSchema.max(1_000),
    status: z.enum(["draft", "approved"]).default("draft"),
    surface: z
      .object({
        type: z.literal("web"),
        appId: identifierSchema,
        entryUrl: z.url(),
        allowedOrigins: z.array(z.url()).min(1),
      })
      .strict(),
    inputs: z.record(fieldNameSchema, inputDefinitionSchema),
    steps: z.array(artifactStepSchema).min(1),
    outputs: z.record(fieldNameSchema, outputDefinitionSchema),
    checkpoint: checkpointSchema,
    knownOutcomes: z.array(knownOutcomeSchema).default([]),
  })
  .strict()
  .superRefine((artifact, context) => {
    const stepIds = new Set<string>();

    artifact.steps.forEach((step, index) => {
      if (stepIds.has(step.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate step ID '${step.id}'.`,
          path: ["steps", index, "id"],
        });
      }
      stepIds.add(step.id);

      if (
        step.action === "fill" &&
        step.value.source === "input" &&
        !(step.value.name in artifact.inputs)
      ) {
        context.addIssue({
          code: "custom",
          message: `Step references unknown input '${step.value.name}'.`,
          path: ["steps", index, "value", "name"],
        });
      }
    });
  });

export type CapabilityArtifact = z.infer<typeof capabilityArtifactSchema>;

export function parseCapabilityArtifact(input: unknown): CapabilityArtifact {
  return capabilityArtifactSchema.parse(input);
}
