import type { Contract, InputRule, PricingConfig } from "../src/types.js";

export const fixtureContract: Contract = {
  generated_by: "test",
  catalog_models: ["flux-test-pro", "suno-test"],
  actions: {
    "flux-test/text-to-image": {
      provider: "Black Forest Labs",
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
      provider: "Suno",
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
    }
  },
  unresolved_actions: []
};

export const fixturePricing: PricingConfig = {
  markup_rate: 2,
  endpoints: {
    "Black Forest Labs/Flux Test/flux-test-pro/text_to_image": { cost_unit_price_cents: 5 }
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
