import type { PriceQuoteInput, PriceScheduleFilters, RunApiClient } from "./runapi-client.js";

export const CANONICAL_PRICING_URL = "https://runapi.ai/pricing";
export const RUNTIME_PRICING_TIMEOUT_MS = 10_000;

export type RuntimePricingClient = Pick<RunApiClient, "listPriceSchedules" | "quotePrice">;

export class RuntimePricingLookupError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "RuntimePricingLookupError";
  }
}

export async function lookupRuntimePrice(
  client: Pick<RuntimePricingClient, "listPriceSchedules">,
  filters: Required<Pick<PriceScheduleFilters, "service" | "action">> & PriceScheduleFilters
) {
  try {
    const resolvedFilters = {
      ...filters,
      service: filters.service?.replace(/-/g, "_")
    };
    const response = await withRuntimePricingTimeout((signal) =>
      client.listPriceSchedules(resolvedFilters, { signal })
    );
    const priceSchedule = response.price_schedules.find((schedule) => matches(schedule, resolvedFilters));
    if (!priceSchedule) {
      throw new RuntimePricingLookupError("No current price schedule is available for this RunAPI model/action.");
    }

    return { as_of: response.as_of, price_schedule: priceSchedule };
  } catch (error) {
    if (error instanceof RuntimePricingLookupError) throw error;
    throw new RuntimePricingLookupError("Runtime pricing lookup is unavailable.", error);
  }
}

export async function quoteRuntimePrice(client: Pick<RuntimePricingClient, "quotePrice">, input: PriceQuoteInput) {
  try {
    return await withRuntimePricingTimeout((signal) => client.quotePrice(input, { signal }));
  } catch (error) {
    throw new RuntimePricingLookupError("Runtime pricing quote is unavailable.", error);
  }
}

function withRuntimePricingTimeout<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Runtime pricing request timed out."));
    }, RUNTIME_PRICING_TIMEOUT_MS);

    request(controller.signal).then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export function runtimePricingErrorMessage(_error: unknown): string {
  return `Current runtime pricing is unavailable. Retry later or view ${CANONICAL_PRICING_URL}.`;
}

function matches(schedule: Record<string, unknown>, filters: PriceScheduleFilters): boolean {
  return Object.entries(filters).every(([key, value]) => value === undefined || schedule[key] === value);
}
