import { z } from "zod";
import type { ContractField } from "./types.js";

export function validateParams(fields: Record<string, ContractField>, params: Record<string, unknown>) {
  return z.object(zodShapeForFields(fields)).passthrough().parse(params);
}

// The contract stores constraints, not complete JSON Schema. This keeps strict
// checks for required/enums/ranges while allowing API-specific params to pass through.
export function zodShapeForFields(fields: Record<string, ContractField>): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, zodForField(name, field)]));
}

function zodForField(name: string, field: ContractField): z.ZodTypeAny {
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
    if (field.pattern) {
      stringSchema = stringSchema.regex(new RegExp(field.pattern));
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
    const itemSchema = field.items ? zodForField(`${name}[]`, { ...field.items, required: true }) : z.unknown();
    let arraySchema = z.array(itemSchema, { invalid_type_error: `${name} must be an array` });
    const itemCountError = itemCountMessage(name, field.min_items, field.max_items);
    if (field.min_items !== undefined) {
      arraySchema = arraySchema.min(field.min_items, { message: itemCountError });
    }
    if (field.max_items !== undefined) {
      arraySchema = arraySchema.max(field.max_items, { message: itemCountError });
    }
    schema = arraySchema;
  } else if (field.type === "object") {
    schema = field.properties ? z.object(zodShapeForFields(field.properties)) : z.record(z.unknown());
  } else {
    schema = z.unknown();
  }

  if (field.description) {
    schema = schema.describe(field.description);
  }

  return field.required ? schema : schema.optional();
}

function itemCountMessage(name: string, min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) {
    return `${name} must contain between ${min} and ${max} items`;
  }
  if (min !== undefined) {
    return `${name} must contain at least ${min} items`;
  }
  return `${name} must contain at most ${max} items`;
}

function literalFor(value: unknown): z.ZodLiteral<unknown> {
  return z.literal(value as never);
}
