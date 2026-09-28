import { describe, expect, it } from "vitest";
import { z as z4 } from "zod/v4";
import { mcpZodShapeForFields, validateParams } from "../src/schema.js";
import type { ContractField } from "../src/types.js";

const fields: Record<string, ContractField> = {
  prompt: { required: true, type: "string" },
  steps: { type: "integer", min: 1, max: 50 },
  mode: { enum: ["fast", "slow"] }
};

describe("schema", () => {
  describe.each([
    ["runtime", validateParams],
    ["tool input", (fields: Record<string, ContractField>, params: Record<string, unknown>) => z4.object(mcpZodShapeForFields(fields)).parse(params)]
  ] as const)("%s structured data", (_name, parse) => {
    const structuredFields: Record<string, ContractField> = {
      state: { type: ["string", "object", "array"], required: true, additionalProperties: true },
      questions: {
        type: "object",
        required: true,
        additionalProperties: true,
        properties: { known: { type: "object", additionalProperties: true } }
      }
    };

    it("preserves open properties at every nesting level", () => {
      const input = {
        state: { customer: { history: [null, false, 3] } },
        questions: {
          known: { instructions: { prompt: "Classify" }, criteria: { one: null, two: ["description"] } },
          custom: { type: "noul", instructions: ["Decide"] }
        }
      };
      expect(parse(structuredFields, input)).toEqual(input);
    });

    it("accepts text and array state while rejecting unsupported or absent state", () => {
      for (const state of ["ticket text", [{ text: "hello" }, null, 3]]) {
        expect(parse(structuredFields, { state, questions: {} })).toEqual({ state, questions: {} });
      }
      for (const state of [null, true, 3, undefined]) {
        expect(() => parse(structuredFields, { state, questions: {} })).toThrow();
      }
    });
  });

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

  it("counts string length in Unicode code points", () => {
    const lengthFields: Record<string, ContractField> = {
      prompt: { type: "string", length: true, max: 2, required: true }
    };

    expect(validateParams(lengthFields, { prompt: "😀😀" })).toMatchObject({ prompt: "😀😀" });
    expect(() => validateParams(lengthFields, { prompt: "😀😀😀" })).toThrow("prompt must be at most 2 characters");
  });

  it("enforces nested array item contracts", () => {
    const nestedFields: Record<string, ContractField> = {
      speakers: {
        type: "array",
        required: true,
        min_items: 1,
        items: {
          type: "object",
          properties: {
            speaker_id: { type: "string", required: true, pattern: "^Speaker [1-9][0-9]*$" },
            voice_name: { type: "string", required: true, enum: ["Fenrir", "Puck"] }
          }
        }
      },
      dialogue_turns: {
        type: "array",
        required: true,
        min_items: 1,
        items: {
          type: "object",
          properties: {
            speaker_id: { type: "string", required: true },
            text: { type: "string", required: true, length: true, max: 10_000 }
          }
        }
      }
    };

    expect(validateParams(nestedFields, {
      speakers: [{ speaker_id: "Speaker 1", voice_name: "Fenrir" }],
      dialogue_turns: [{ speaker_id: "Speaker 1", text: "Welcome." }]
    })).toMatchObject({ speakers: [{ speaker_id: "Speaker 1", voice_name: "Fenrir" }] });
    expect(() => validateParams(nestedFields, { speakers: [], dialogue_turns: [] })).toThrow();
    expect(() => validateParams(nestedFields, {
      speakers: [{ speaker_id: "Host", voice_name: "Unknown" }],
      dialogue_turns: [{ speaker_id: "Host", text: "Welcome." }]
    })).toThrow();
  });
});
