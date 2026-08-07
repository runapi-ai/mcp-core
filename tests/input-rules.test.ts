import { describe, expect, it } from "vitest";
import { validateInputRules } from "../src/input-rules.js";
import { sunoInputRules } from "./fixtures.js";

const rules = sunoInputRules.text_to_music;

describe("validateInputRules (engine)", () => {
  it("returns undefined when there are no rules", () => {
    expect(validateInputRules([], { anything: true })).toBeUndefined();
  });

  it("requires the controlling field before a shape can be chosen", () => {
    expect(validateInputRules(rules, {})).toBe("vocal_mode is required to choose a valid parameter shape.");
  });

  it("reports missing required fields for the matched rule", () => {
    const error = validateInputRules(rules, { vocal_mode: "instrumental" });
    expect(error).toContain("vocal_mode=instrumental");
    expect(error).toContain("requires style, title");
  });

  it("reports forbidden fields for the matched rule", () => {
    const error = validateInputRules(rules, { vocal_mode: "auto_lyrics", prompt: "a song", lyrics: "la" });
    expect(error).toContain("must not include lyrics");
  });

  it("supports forbidden-only rules", () => {
    const error = validateInputRules(
      [{ when: { model: "kling-v3-turbo-image-to-video" }, forbidden: ["negative_prompt"], description: "V3 Turbo does not accept negative_prompt." }],
      { model: "kling-v3-turbo-image-to-video", negative_prompt: "no blur" }
    );

    expect(error).toBe("model=kling-v3-turbo-image-to-video must not include negative_prompt.");
  });

  it("checks every matching layered rule without requiring optional condition fields", () => {
    const layeredRules = [
      { when: { model: "lite" }, forbidden: ["seed"] },
      { when: { model: "lite", input_mode: "reference", duration_seconds: 4 }, forbidden: ["duration_seconds"] }
    ];

    expect(validateInputRules(layeredRules, { model: "lite" })).toBeUndefined();
    expect(validateInputRules(layeredRules, {
      model: "lite",
      input_mode: "reference",
      duration_seconds: 4
    })).toBe("model=lite, input_mode=reference, duration_seconds=4 must not include duration_seconds.");
  });

  it("passes when the matched rule is satisfied", () => {
    expect(validateInputRules(rules, { vocal_mode: "auto_lyrics", prompt: "a song" })).toBeUndefined();
  });

  it("supports unconditional required-any rules", () => {
    const unconditional = [{ required_any: ["first_frame_image_url", "last_frame_image_url"] }];

    expect(validateInputRules(unconditional, {})).toBe(
      "requires one of first_frame_image_url, last_frame_image_url."
    );
    expect(validateInputRules(unconditional, { last_frame_image_url: "https://cdn.runapi.ai/last.png" })).toBeUndefined();
  });

  it("supports presence conditions and narrowed enums", () => {
    const conditional = [{
      when: { reference_image_urls: { present: false }, reference_video_urls: { present: false } },
      required: ["aspect_ratio"],
      enum: { aspect_ratio: ["16:9", "1:1"] }
    }];

    expect(validateInputRules(conditional, {})).toBe(
      "reference_image_urls is absent, reference_video_urls is absent requires aspect_ratio."
    );
    expect(validateInputRules(conditional, { aspect_ratio: "adaptive" })).toBe(
      "reference_image_urls is absent, reference_video_urls is absent requires aspect_ratio to be one of 16:9, 1:1."
    );
    expect(validateInputRules(conditional, { reference_image_urls: ["https://cdn.runapi.ai/ref.png"] })).toBeUndefined();
  });

  it("treats an empty array as absent", () => {
    const conditional = [{
      when: { reference_image_urls: { present: false } },
      required: ["aspect_ratio"]
    }];

    // [] supplies nothing, so the absent branch still applies.
    expect(validateInputRules(conditional, { reference_image_urls: [] })).toBe(
      "reference_image_urls is absent requires aspect_ratio."
    );

    // And a forbidden array field is not "included" by an empty array.
    expect(validateInputRules(
      [{ when: { model: "kling-3.0" }, forbidden: ["reference_image_urls"] }],
      { model: "kling-3.0", reference_image_urls: [] }
    )).toBeUndefined();
  });
});
