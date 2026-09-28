import { z } from "zod";
import { z as z4 } from "zod/v4";
import type { ContractField } from "./types.js";

type ZodV4Schema = z4.ZodType<any, any>;
type Literal = string | number | bigint | boolean | null | undefined;
type StringLengthMode = "native" | "code_point";

export function validateParams(fields: Record<string, ContractField>, params: Record<string, unknown>) {
  return z.object(zodShapeForFieldsWithMode(fields, "code_point")).passthrough().parse(params);
}

// The contract stores constraints, not complete JSON Schema. This keeps strict
// checks for required/enums/ranges while allowing API-specific params to pass through.
export function zodShapeForFields(fields: Record<string, ContractField>): Record<string, z.ZodTypeAny> {
  return zodShapeForFieldsWithMode(fields, "native");
}

function zodShapeForFieldsWithMode(
  fields: Record<string, ContractField>,
  stringLengthMode: StringLengthMode
): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, zodForField(name, field, stringLengthMode)])
  );
}

function zodForField(name: string, field: ContractField, stringLengthMode: StringLengthMode): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  const min = field.min ?? field.minimum;
  const max = field.max ?? field.maximum;

  if (field.enum?.length) {
    schema = z.union(field.enum.map((value) => literalFor(value)) as [z.ZodLiteral<unknown>, z.ZodLiteral<unknown>, ...z.ZodLiteral<unknown>[]]);
  } else if (Array.isArray(field.type)) {
    const variants = field.type.map((type) => zodForField(name, { ...field, type, required: true }, stringLengthMode));
    schema = variants.length === 1 ? variants[0] : z.union(variants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  } else if (field.type === "string" || field.length) {
    let stringSchema = z.string();
    if (stringLengthMode === "native" && min !== undefined) {
      stringSchema = stringSchema.min(min);
    }
    if (stringLengthMode === "native" && max !== undefined) {
      stringSchema = stringSchema.max(max);
    }
    if (field.pattern) {
      stringSchema = stringSchema.regex(new RegExp(field.pattern));
    }
    schema = stringSchema;
    if (stringLengthMode === "code_point" && (min !== undefined || max !== undefined)) {
      schema = schema.refine((value: string) => {
        const length = Array.from(value).length;
        return (min === undefined || length >= min) && (max === undefined || length <= max);
      }, { message: stringLengthMessage(name, min, max) });
    }
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
    const itemSchema = field.items
      ? zodForField(`${name}[]`, { ...field.items, required: true }, stringLengthMode)
      : z.unknown();
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
    const objectSchema = z.object(zodShapeForFieldsWithMode(field.properties ?? {}, stringLengthMode));
    if (field.additionalProperties === false) {
      schema = objectSchema.strict();
    } else if (field.additionalProperties === true || !field.properties) {
      schema = objectSchema.passthrough();
    } else {
      schema = objectSchema;
    }
  } else {
    schema = z.unknown();
  }

  if (field.description) {
    schema = schema.describe(field.description);
  }

  return field.required ? schema : schema.optional();
}

// The MCP SDK supports Zod 4 metadata when converting a tool input to JSON
// Schema. Keep the public Zod 3 builder above stable for existing consumers,
// while this builder preserves code-point validation and emits min/maxLength.
export function mcpZodShapeForFields(fields: Record<string, ContractField>): Record<string, ZodV4Schema> {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, mcpZodForField(name, field)]));
}

function mcpZodForField(name: string, field: ContractField): ZodV4Schema {
  let schema: ZodV4Schema;

  const min = field.min ?? field.minimum;
  const max = field.max ?? field.maximum;

  if (field.enum?.length) {
    schema = z4.union(field.enum.map((value) => z4.literal(value as Literal)));
  } else if (Array.isArray(field.type)) {
    const variants = field.type.map((type) => mcpZodForField(name, { ...field, type, required: true }));
    schema = variants.length === 1 ? variants[0] : z4.union(variants);
  } else if (field.type === "string" || field.length) {
    let stringSchema = z4.string();
    if (field.pattern) {
      stringSchema = stringSchema.regex(new RegExp(field.pattern));
    }
    schema = stringSchema;
    if (min !== undefined || max !== undefined) {
      schema = schema.refine((value: string) => {
        const length = Array.from(value).length;
        return (min === undefined || length >= min) && (max === undefined || length <= max);
      }, { message: stringLengthMessage(name, min, max) }).meta({
        ...(min === undefined ? {} : { minLength: min }),
        ...(max === undefined ? {} : { maxLength: max })
      });
    }
  } else if (field.type === "number" || field.type === "integer" || min !== undefined || max !== undefined) {
    let numberSchema = z4.number();
    if (min !== undefined) {
      numberSchema = numberSchema.min(min);
    }
    if (max !== undefined) {
      numberSchema = numberSchema.max(max);
    }
    schema = numberSchema;
  } else if (field.type === "boolean") {
    schema = z4.boolean();
  } else if (field.type === "array") {
    const itemSchema = field.items ? mcpZodForField(`${name}[]`, { ...field.items, required: true }) : z4.unknown();
    let arraySchema = z4.array(itemSchema, { error: `${name} must be an array` });
    const itemCountError = itemCountMessage(name, field.min_items, field.max_items);
    if (field.min_items !== undefined) {
      arraySchema = arraySchema.min(field.min_items, { message: itemCountError });
    }
    if (field.max_items !== undefined) {
      arraySchema = arraySchema.max(field.max_items, { message: itemCountError });
    }
    schema = arraySchema;
  } else if (field.type === "object") {
    const objectSchema = z4.object(mcpZodShapeForFields(field.properties ?? {}));
    if (field.additionalProperties === false) {
      schema = objectSchema.strict();
    } else if (field.additionalProperties === true || !field.properties) {
      schema = objectSchema.passthrough();
    } else {
      schema = objectSchema;
    }
  } else {
    schema = z4.unknown();
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

function stringLengthMessage(name: string, min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) {
    return `${name} must be between ${min} and ${max} characters`;
  }
  if (min !== undefined) {
    return `${name} must be at least ${min} characters`;
  }
  return `${name} must be at most ${max} characters`;
}

function literalFor(value: unknown): z.ZodLiteral<unknown> {
  return z.literal(value as never);
}
