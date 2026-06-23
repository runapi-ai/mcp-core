import { z } from "zod";
import type { ContractField } from "./types.js";

export function validateParams(fields: Record<string, ContractField>, params: Record<string, unknown>) {
  return z.object(zodShapeForFields(fields)).passthrough().parse(params);
}

// The contract stores constraints, not complete JSON Schema. This keeps strict
// checks for required/enums/ranges while allowing API-specific params to pass through.
export function zodShapeForFields(fields: Record<string, ContractField>): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, zodForField(field)]));
}

function zodForField(field: ContractField): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  const min = field.min ?? field.minimum;
  const max = field.max ?? field.maximum;

  if (field.enum?.length) {
    schema = z.union(field.enum.map((value) => literalFor(value)) as [z.ZodLiteral<unknown>, z.ZodLiteral<unknown>, ...z.ZodLiteral<unknown>[]]);
  } else if (field.type === "string" || field.length) {
    let stringSchema = z.string();
    if (min !== undefined) {
      stringSchema = stringSchema.min(min);
    }
    if (max !== undefined) {
      stringSchema = stringSchema.max(max);
    }
    schema = stringSchema;
  } else if (field.type === "number" || field.type === "integer" || min !== undefined || max !== undefined) {
    let numberSchema = z.number();
    if (min !== undefined) {
      numberSchema = numberSchema.min(min);
    }
    if (max !== undefined) {
      numberSchema = numberSchema.max(max);
    }
    schema = numberSchema;
  } else if (field.type === "boolean") {
    schema = z.boolean();
  } else if (field.type === "array") {
    schema = z.array(z.unknown());
  } else if (field.type === "object") {
    schema = z.record(z.unknown());
  } else {
    schema = z.unknown();
  }

  return field.required ? schema : schema.optional();
}

function literalFor(value: unknown): z.ZodLiteral<unknown> {
  return z.literal(value as never);
}
