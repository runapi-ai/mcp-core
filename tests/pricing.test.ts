import { describe, expect, it } from "vitest";
import { findModelForAction } from "../src/contract.js";
import { priceForModel } from "../src/pricing.js";
import { fixtureContract, fixturePricing } from "./fixtures.js";

describe("priceForModel (final embedded lookup)", () => {
  it("returns the embedded final price as-is, keyed by model/endpoint", () => {
    const info = findModelForAction("flux-test", "text_to_image", "flux-test-pro", fixtureContract)!;
    const result = priceForModel(info, fixturePricing);
    expect(result.pricing).toEqual({ unit_price_cents: 10 });
    expect(result.pricing_source).toBe("build-time pricing snapshot");
    expect(result.pricing_url).toBe("https://runapi.ai/pricing");
  });

  it("falls back to the pricing page when the endpoint is absent", () => {
    const info = findModelForAction("suno-test", "text_to_music", "suno-test", fixtureContract)!;
    const result = priceForModel(info, fixturePricing);
    expect(result.pricing).toBeUndefined();
    expect(result.pricing_source).toBe("pricing page");
    expect(result.pricing_url).toBe("https://runapi.ai/pricing");
  });
});
