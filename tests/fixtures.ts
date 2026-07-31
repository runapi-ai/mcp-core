import type { Contract, InputRule } from "../src/types.js";

export const fixtureContract: Contract = {
  catalog_models: ["flux-test-pro", "suno-test", "seedream-test-quality", "seedream-test-resolution"],
  actions: {
    // Divergent-required fixture: one model requires aspect_ratio + output_quality,
    // the other requires only source_image_urls (the rest optional). Exercises
    // per-model required validation against a single advertised tool schema.
    "seedream-test/edit-image": {
      model: "Seedream Test",
      endpoint: "edit_image",
      models: ["seedream-test-quality", "seedream-test-resolution"],
      fields_by_model: {
        "seedream-test-quality": {
          aspect_ratio: { required: true, enum: ["1:1", "16:9"] },
          output_quality: { required: true, enum: ["basic", "high"] },
          source_image_urls: { required: true, type: "array", min_items: 1, max_items: 2 }
        },
        "seedream-test-resolution": {
          source_image_urls: { required: true, type: "array", min_items: 1, max_items: 3 },
          aspect_ratio: { enum: ["16:9", "9:16"] },
          output_count: { enum: [1, 2, 3, 4] },
          output_resolution: { enum: ["1k", "2k", "4k"] }
        }
      }
    },
    "flux-test/text-to-image": {
      model: "Flux Test",
      endpoint: "text_to_image",
      models: ["flux-test-pro"],
      fields_by_model: {
        "flux-test-pro": {
          prompt: { required: true, type: "string" },
          steps: { type: "integer", min: 1, max: 50 }
        }
      }
    },
    "suno-test/text-to-music": {
      model: "Suno Test",
      endpoint: "text_to_music",
      models: ["suno-test"],
      fields_by_model: {
        "suno-test": {
          vocal_mode: { required: true, enum: ["auto_lyrics", "exact_lyrics", "instrumental"] },
          prompt: { type: "string" },
          lyrics: { type: "string" },
          style: { type: "string" },
          title: { type: "string" }
        }
      }
    },
    "suno-test/generate-lyrics": {
      model: "Suno Test",
      endpoint: "generate_lyrics",
      models: [],
      fields_by_model: {
        "_": {
          prompt: { type: "string", description: "Lyrics generation prompt." },
          callback_url: { type: "string", description: "Webhook URL for async notifications." }
        }
      }
    }
  }
};

export const sunoInputRules: Record<string, InputRule[]> = {
  text_to_music: [
    {
      when: { vocal_mode: "auto_lyrics" },
      required: ["prompt"],
      forbidden: ["lyrics", "style", "title"],
      description: "auto_lyrics requires prompt and must not include lyrics, style, or title."
    },
    {
      when: { vocal_mode: "instrumental" },
      required: ["style", "title"],
      forbidden: ["prompt", "lyrics"],
      description: "instrumental requires style and title, and must not include prompt or lyrics."
    }
  ]
};
