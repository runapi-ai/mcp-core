import { z as z4 } from "zod/v4";
import type { ContractField } from "./types.js";

// Fields deliberately remain permissive at runtime: RunAPI is the input validator.
// Zod metadata supplies discovery-only JSON Schema types and required hints without
// causing the MCP SDK to reject wrong types or omitted contract fields locally.
export function mcpZodShapeForFields(fields: Record<string, ContractField>): Record<string, z4.ZodType<any, any>> {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [
    name,
    z4.unknown().optional().meta(fieldJsonSchema(field)).describe(fieldDescription(field))
  ]));
}

export function mcpZodObjectForFields(
  fields: Record<string, ContractField>,
  extras: Record<string, z4.ZodType<any, any>> = {}
): z4.ZodObject<any> {
  const required = Object.entries(fields).filter(([, field]) => field.required).map(([name]) => name);
  return z4.object({ ...mcpZodShapeForFields(fields), ...extras }).passthrough().meta({ required });
}

function fieldJsonSchema(field: ContractField): Record<string, unknown> {
  const types = field.type === undefined ? undefined : (Array.isArray(field.type) ? field.type : [field.type]);
  const schemas = types?.map((type) => {
    const schema: Record<string, unknown> = { type: jsonSchemaType(type) };
    if (type === "array") schema.items = field.items ? fieldJsonSchema(field.items) : {};
    if (type === "object" && field.properties) {
      schema.properties = Object.fromEntries(Object.entries(field.properties).map(([name, child]) => [name, fieldJsonSchema(child)]));
      const required = Object.entries(field.properties).filter(([, child]) => child.required).map(([name]) => name);
      if (required.length > 0) schema.required = required;
      schema.additionalProperties = field.additionalProperties ?? true;
    }
    return schema;
  });
  if (!schemas || schemas.length === 0) return {};
  return schemas.length === 1 ? schemas[0] : { anyOf: schemas };
}

function jsonSchemaType(type: string): string {
  if (type === "int" || type === "integer") return "integer";
  if (type === "float" || type === "double") return "number";
  if (type === "bool") return "boolean";
  return type;
}

function fieldDescription(field: ContractField): string {
  return [
    field.description,
    field.type ? `Declared type: ${Array.isArray(field.type) ? field.type.join(" or ") : field.type}.` : undefined,
    field.enum?.length ? `Known values: ${field.enum.map((value) => JSON.stringify(value)).join(", ")}.` : undefined
  ].filter(Boolean).join(" ");
}
