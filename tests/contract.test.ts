import { describe, expect, it } from "vitest";
import { declaredFieldsForAction, fieldSummary, findModel, findModelForAction, findModels, listActionGroups, listContractModels } from "../src/contract.js";
import { fixtureContract } from "./fixtures.js";

describe("contract queries (injection)", () => {
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
