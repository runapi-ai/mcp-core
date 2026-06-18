import { describe, expect, it } from "vitest";
import { findModelForAction } from "../src/contract.js";
import { priceForModel } from "../src/pricing.js";
import { fixtureContract, fixturePricing } from "./fixtures.js";

describe("priceForModel (injection)", () => {
  it("applies the effective markup to the snapshot price", () => {
    const info = findModelForAction("flux-test", "text_to_image", "flux-test-pro", fixtureContract)!;
    const result = priceForModel(info, fixturePricing);
    expect(result.pricing).toMatchObject({ unit_price_cents: 10 }); // 5 * markup_rate(2)
    expect(result.pricing_source).toBe("build-time pricing snapshot");
  });

  it("falls back to the pricing page when the endpoint is absent", () => {
    const info = findModelForAction("suno-test", "text_to_music", "suno-test", fixtureContract)!;
    const result = priceForModel(info, fixturePricing);
    expect(result.pricing).toBeUndefined();
    expect(result.pricing_source).toBe("pricing page");
    expect(result.pricing_url).toBe("https://runapi.ai/pricing");
  });
});
