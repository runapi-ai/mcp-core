import { describe, expect, it } from "vitest";
import { validateParams, zodShapeForFields } from "../src/schema.js";
import type { ContractField } from "../src/types.js";

const fields: Record<string, ContractField> = {
  prompt: { required: true, type: "string" },
  steps: { type: "integer", min: 1, max: 50 },
  mode: { enum: ["fast", "slow"] }
};

describe("schema", () => {
  it("accepts valid params and passes through extras", () => {
    expect(validateParams(fields, { prompt: "hi", steps: 10, extra: true })).toMatchObject({
      prompt: "hi",
      steps: 10,
      extra: true
    });
  });

  it("rejects a missing required typed field", () => {
    // Required is enforced for typed/enum/range fields; untyped fields stay z.unknown() and pass through.
    expect(() => validateParams({ steps: { required: true, type: "integer" } }, {})).toThrow();
  });

  it("enforces numeric ranges and enums", () => {
    expect(() => validateParams(fields, { prompt: "hi", steps: 999 })).toThrow();
    expect(() => validateParams(fields, { prompt: "hi", mode: "turbo" })).toThrow();
  });

  it("types plain string fields and enforces required strings", () => {
    expect(() => validateParams(fields, {})).toThrow();
    expect(() => validateParams(fields, { prompt: 123 })).toThrow();
    expect(validateParams(fields, { prompt: "hi" })).toMatchObject({ prompt: "hi" });
  });

  it("treats min/max as string length when the field carries the length marker", () => {
    const lengthFields: Record<string, ContractField> = {
      caption: { type: "string", min: 1, max: 5 },
      headline: { length: true, min: 1, max: 5, required: true }
    };
    expect(() => validateParams(lengthFields, { headline: "way too long" })).toThrow();
    expect(validateParams(lengthFields, { headline: "ok", caption: "fine" })).toMatchObject({ headline: "ok" });
  });

  it("exposes a reusable zod shape builder", () => {
    const shape = zodShapeForFields(fields);
    expect(Object.keys(shape).sort()).toEqual(["mode", "prompt", "steps"]);
  });
});
