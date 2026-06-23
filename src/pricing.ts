import type { ModelInfo, PricingConfig, PricingEndpoint } from "./types.js";

// Packages embed final customer prices keyed by `${model}/${endpoint}`. This is
// a pure lookup — the markup math already ran when the price was embedded.
export function priceForModel(info: ModelInfo, source: PricingConfig) {
  // No-model endpoints are keyed under the "_" sentinel, matching the contract roster.
  const endpoint = source.endpoints?.[`${info.model ?? "_"}/${info.action}`];
  const hasPrice = endpoint ? hasPriceData(endpoint) : false;

  return {
    pricing: hasPrice ? endpoint : undefined,
    pricing_source: hasPrice ? "build-time pricing snapshot" : "pricing page",
    pricing_url: "https://runapi.ai/pricing"
  };
}

function hasPriceData(endpoint: PricingEndpoint): boolean {
  return Object.values(endpoint).some((value) => value !== undefined && value !== null);
}
