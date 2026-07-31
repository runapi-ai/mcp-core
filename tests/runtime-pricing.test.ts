import { describe, expect, it, vi } from "vitest";
import {
  CANONICAL_PRICING_URL,
  lookupRuntimePrice,
  quoteRuntimePrice,
  RUNTIME_PRICING_TIMEOUT_MS,
  runtimePricingErrorMessage
} from "../src/runtime-pricing.js";

describe("runtime pricing", () => {
  it("returns the matching current schedule instead of an embedded snapshot", async () => {
    const result = await lookupRuntimePrice({
      listPriceSchedules: vi.fn(async () => ({
        as_of: "2026-07-23T00:00:00.000000Z",
        price_schedules: [
          {service: "suno", action: "text_to_music", model: "suno-v4", unit_price_cents: 19}
        ]
      }))
    }, {service: "suno", action: "text_to_music", model: "suno-v4"});

    expect(result).toMatchObject({as_of: "2026-07-23T00:00:00.000000Z", price_schedule: {unit_price_cents: 19}});
  });

  it("uses the public API namespace for hyphenated model-line services", async () => {
    const listPriceSchedules = vi.fn(async () => ({
      as_of: "2026-07-23T00:00:00.000000Z",
      price_schedules: [{service: "flux_2", action: "text_to_image", model: "flux-2-pro", unit_price_cents: 19}]
    }));

    await expect(lookupRuntimePrice({listPriceSchedules}, {
      service: "flux-2",
      action: "text_to_image",
      model: "flux-2-pro"
    })).resolves.toMatchObject({price_schedule: {unit_price_cents: 19}});
    expect(listPriceSchedules).toHaveBeenCalledWith({
      service: "flux_2",
      action: "text_to_image",
      model: "flux-2-pro"
    }, {signal: expect.any(AbortSignal)});
  });

  it("maps unavailable runtime pricing to a stable canonical message", async () => {
    await expect(lookupRuntimePrice({
      listPriceSchedules: vi.fn(async () => { throw new Error("network"); })
    }, {service: "suno", action: "text_to_music"})).rejects.toThrow("Runtime pricing lookup is unavailable.");
    expect(runtimePricingErrorMessage(new Error("network"))).toContain(CANONICAL_PRICING_URL);
  });

  it("bounds a runtime pricing lookup that never responds", async () => {
    vi.useFakeTimers();
    try {
      const lookup = lookupRuntimePrice({
        listPriceSchedules: vi.fn(() => new Promise(() => {}))
      }, {service: "suno", action: "text_to_music"});
      const rejection = expect(lookup).rejects.toThrow("Runtime pricing lookup is unavailable.");

      await vi.advanceTimersByTimeAsync(RUNTIME_PRICING_TIMEOUT_MS);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares the stable unavailable mapping for runtime quotes", async () => {
    await expect(quoteRuntimePrice({
      quotePrice: vi.fn(async () => { throw new Error("network"); })
    }, {service: "suno", action: "text_to_music", params: {duration: 30}})).rejects.toThrow("Runtime pricing quote is unavailable.");
  });
});
