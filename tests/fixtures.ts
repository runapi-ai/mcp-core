import type { Contract } from "../src/types.js";

export const fixtureContract: Contract = {
  actions: {
    // Divergent-required fixture: one model requires aspect_ratio + output_quality,
    // the other requires only source_image_urls (the rest optional). Both share
    // one advertised tool schema; RunAPI enforces each model's requirements.
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
          prompt: { type: "string", length: true, max: 2, description: "Lyrics generation prompt." },
          callback_url: { type: "string", description: "Webhook URL for async notifications." }
        }
      }
    },
    // Provider-neutral resource: published on its own route rather than under
    // the model line's service slug.
    "suno-test/music-visualizations": {
      model: "Suno Test",
      endpoint: "visualize_music",
      path: "/api/v1/music_visualizations",
      models: [],
      fields_by_model: {
        "_": {
          source_audio_id: { required: true, type: "string", description: "Audio id to visualize." }
        }
      }
    }
  }
};
