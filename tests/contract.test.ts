import { readFileSync } from "node:fs";
import type { Contract } from "../src/types.js";
import { describe, expect, it } from "vitest";
import { declaredFieldsForAction, fieldSummary, findModel, findModelForAction, findModels, listActionGroups, listContractModels } from "../src/contract.js";
import { fixtureContract } from "./fixtures.js";

describe("retired contract models", () => {
  const contract: Contract = {
    retired_models: {
      elevenlabs: { provider: "ElevenLabs", versions: [{ id: "audio-isolation" }] }
    },
    actions: {
      "elevenlabs/isolate-audio": {
        model: "ElevenLabs", endpoint: "isolate_audio",
        models: ["audio-isolation", "active-audio"],
        fields_by_model: { "active-audio": { prompt: { required: true } } }
      },
      "elevenlabs/retired-audio": {
        model: "ElevenLabs", endpoint: "retired_audio",
        models: ["audio-isolation"], fields_by_model: {}
      },
      "other/isolate-audio": {
        model: "Other", endpoint: "isolate_audio",
        models: ["audio-isolation"], fields_by_model: {}
      }
    }
  };

  it("filters retirement by family across discovery and lookup", () => {
    expect(listContractModels(contract).map(({ service, model }) => [service, model])).toEqual([
      ["elevenlabs", "active-audio"], ["other", "audio-isolation"]
    ]);
    expect(findModels("audio-isolation", contract).map(({ service }) => service)).toEqual(["other"]);
    expect(findModel("active-audio", contract)?.fields.prompt.required).toBe(true);
    const retiredOnly = { ...contract, actions: { "elevenlabs/retired-audio": contract.actions["elevenlabs/retired-audio"] } };
    expect(findModel("audio-isolation", retiredOnly)).toBeUndefined();
    expect(findModels("audio-isolation", retiredOnly)).toEqual([]);
  });

  it("rejects explicit retired models and defaults to an active model", () => {
    expect(findModelForAction("elevenlabs", "isolate_audio", "audio-isolation", contract)).toBeUndefined();
    expect(findModelForAction("elevenlabs", "isolate_audio", undefined, contract)?.model).toBe("active-audio");
    expect(findModelForAction("elevenlabs", "retired_audio", undefined, contract)).toBeUndefined();
  });
});

describe("contract queries (injection)", () => {
  it("omits retired models and their exclusive actions from the shipped aggregate catalog", () => {
    const contract = JSON.parse(readFileSync(new URL("../../aggregate/data/contract.json", import.meta.url), "utf8")) as Contract;
    const models = listContractModels(contract).map((model) => model.model);
    for (const retired of ["sound-effect-v2", "speech-to-text", "kling-ai-avatar-v1-pro", "kling-v1-avatar-standard", "luma-modify-video", "audio-isolation", "ideogram-v3-reframe", "runway-aleph"]) {
      expect(models).not.toContain(retired);
      expect(findModels(retired, contract)).toEqual([]);
    }
    for (const action of ["elevenlabs/isolate-audio", "elevenlabs/speech-to-text", "elevenlabs/text-to-sound", "luma/modify-video", "ideogram-v3/reframe-image", "runway-aleph/edit-video"]) {
      expect(contract.actions).not.toHaveProperty(action);
    }
    expect(findModels("kling-ai-avatar-pro", contract)).not.toEqual([]);
    expect(findModels("kling-ai-avatar-standard", contract)).not.toEqual([]);
  });

  it("lists every model from the injected contract", () => {
    const models = listContractModels(fixtureContract);
    expect(models.map((m) => m.model).sort()).toEqual([
      "flux-test-pro",
      "seedream-test-quality",
      "seedream-test-resolution",
      "suno-test"
    ]);
  });

  it("finds a model by slug", () => {
    expect(findModel("flux-test-pro", fixtureContract)).toMatchObject({
      service: "flux-test",
      action: "text_to_image",
      model_line: "Flux Test"
    });
  });

  it("resolves a service/action/model combination", () => {
    const info = findModelForAction("suno-test", "text_to_music", "suno-test", fixtureContract);
    expect(info?.model).toBe("suno-test");
    expect(info?.fields.vocal_mode?.enum).toEqual(["auto_lyrics", "exact_lyrics", "instrumental"]);
  });

  it("defaults to the first model when none is given", () => {
    const info = findModelForAction("flux-test", "text_to_image", undefined, fixtureContract);
    expect(info?.model).toBe("flux-test-pro");
  });

  it("returns undefined for an unknown model on an action", () => {
    expect(findModelForAction("flux-test", "text_to_image", "nope", fixtureContract)).toBeUndefined();
    expect(findModels("nope", fixtureContract)).toEqual([]);
  });

  it("resolves a no-model endpoint from the \"_\" roster", () => {
    const info = findModelForAction("suno-test", "generate_lyrics", undefined, fixtureContract);
    expect(info?.model).toBeUndefined();
    expect(info?.action).toBe("generate_lyrics");
    expect(Object.keys(info?.fields ?? {}).sort()).toEqual(["callback_url", "prompt"]);
  });

  it("groups actions by modality", () => {
    const groups = listActionGroups(fixtureContract);
    expect(groups.find((g) => g.modality === "image")?.actions).toContain("text_to_image");
    expect(groups.find((g) => g.modality === "audio")?.actions).toContain("text_to_music");
  });

  it("summarizes fields with required flags", () => {
    const info = findModel("flux-test-pro", fixtureContract)!;
    const summary = fieldSummary(info.fields);
    expect(summary.find((f) => f.name === "prompt")?.required).toBe(true);
    expect(summary.find((f) => f.name === "steps")).toMatchObject({ min: 1, max: 50 });
  });

  it("declares the union of fields but only requires fields required by every model", () => {
    const action = fixtureContract.actions["seedream-test/edit-image"];
    const declared = declaredFieldsForAction(action);

    expect(Object.keys(declared).sort()).toEqual([
      "aspect_ratio",
      "output_count",
      "output_quality",
      "output_resolution",
      "source_image_urls"
    ]);
    // Required only where every model agrees; divergent-required fields relax to optional.
    expect(declared.source_image_urls?.required).toBe(true);
    expect(declared.aspect_ratio?.required).toBe(false);
    expect(declared.output_quality?.required).toBe(false);
    expect(declared.output_count?.required).toBe(false);
    expect(declared.output_resolution?.required).toBe(false);

    // Shared enum fields advertise the union of every roster's values (deduped),
    // so the declared schema never rejects a value valid for one of the models.
    expect(declared.aspect_ratio?.enum).toEqual(["1:1", "16:9", "9:16"]);
    // A field no roster constrains stays unconstrained (no enum) in the envelope.
    expect(declared.source_image_urls?.enum).toBeUndefined();
  });
});
