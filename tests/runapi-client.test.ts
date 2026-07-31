import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { USER_AGENT } from "../src/constants.js";
import { RunApiClient, taskIdFromResponse, taskStatus } from "../src/runapi-client.js";

const packageMetadata = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { name: string; version: string };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("RunApiClient", () => {
  it("sends the core User-Agent by default", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    await new RunApiClient({ baseUrl: "https://runapi.ai" }, fetchImpl as any).listModels();

    expect(USER_AGENT).toBe(`${packageMetadata.name}/${packageMetadata.version}`);
    expect(fetchImpl).toHaveBeenCalledWith(new URL("https://runapi.ai/v1/models"), expect.objectContaining({
      headers: expect.objectContaining({ "user-agent": USER_AGENT })
    }));
  });

  it("honors an injected User-Agent (used by the aggregate shim)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    await new RunApiClient({ baseUrl: "https://runapi.ai" }, fetchImpl as any, "@runapi.ai/mcp/0.1.8").listModels();

    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.objectContaining({ "user-agent": "@runapi.ai/mcp/0.1.8" })
    }));
  });

  it("injects bearer auth for authenticated requests", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ balance_cents: 100 }));
    await new RunApiClient({ apiKey: "test_key", baseUrl: "https://runapi.ai" }, fetchImpl as any).balance();

    expect(fetchImpl).toHaveBeenCalledWith(new URL("https://runapi.ai/api/v1/me/balance"), expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer test_key" })
    }));
  });

  it("reads public price schedules without a key and uses a key when one is available", async () => {
    const anonymousFetch = vi.fn(async () => jsonResponse({as_of: "2026-07-23T00:00:00Z", price_schedules: []}));
    await new RunApiClient({baseUrl: "https://runapi.ai"}, anonymousFetch as any).listPriceSchedules({
      service: "suno",
      action: "text_to_music"
    });
    expect(anonymousFetch).toHaveBeenCalledWith(
      new URL("https://runapi.ai/api/v1/price_schedules?service=suno&action=text_to_music"),
      expect.objectContaining({headers: expect.not.objectContaining({authorization: expect.any(String)})})
    );

    const authenticatedFetch = vi.fn(async () => jsonResponse({as_of: "2026-07-23T00:00:00Z", price_schedules: []}));
    await new RunApiClient({apiKey: "pricing_key", baseUrl: "https://runapi.ai"}, authenticatedFetch as any).listPriceSchedules();
    expect(authenticatedFetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.objectContaining({authorization: "Bearer pricing_key"})
    }));
  });

  it("forwards a cancellation signal to runtime pricing requests", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({as_of: "2026-07-23T00:00:00Z", price_schedules: []}));
    const controller = new AbortController();

    await new RunApiClient({baseUrl: "https://runapi.ai"}, fetchImpl as any)
      .listPriceSchedules({}, {signal: controller.signal});

    expect(fetchImpl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({signal: controller.signal}));
  });

  it("normalizes model-line service slugs for public price schedules", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({as_of: "2026-07-23T00:00:00Z", price_schedules: []}));
    await new RunApiClient({baseUrl: "https://runapi.ai"}, fetchImpl as any).listPriceSchedules({
      service: "flux-2",
      action: "text_to_image"
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://runapi.ai/api/v1/price_schedules?service=flux_2&action=text_to_image"),
      expect.anything()
    );
  });

  it("quotes current pricing with optional authentication", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({price_quote: {reservation_amount_cents: 12}}));
    await new RunApiClient({baseUrl: "https://runapi.ai"}, fetchImpl as any).quotePrice({
      service: "suno",
      action: "text_to_music",
      model: "suno-v4",
      params: {duration: 30}
    });

    expect(fetchImpl).toHaveBeenCalledWith(new URL("https://runapi.ai/api/v1/price_quotes"), expect.objectContaining({
      method: "POST",
      body: JSON.stringify({service: "suno", action: "text_to_music", model: "suno-v4", params: {duration: 30}})
    }));
  });

  it("reloads the default config for authenticated requests", async () => {
    const originalHome = process.env.HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "runapi-client-home-"));
    const fetchImpl = vi.fn(async () => jsonResponse({ balance_cents: 100 }));

    try {
      process.env.HOME = tempHome;
      const client = new RunApiClient(undefined, fetchImpl as any);
      const configFile = path.join(tempHome, ".config", "runapi", "config.json");
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify({ api_key: "new_token" }));

      await client.balance();

      expect(fetchImpl).toHaveBeenCalledWith(new URL("https://runapi.ai/api/v1/me/balance"), expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer new_token" })
      }));
    } finally {
      process.env.HOME = originalHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("normalizes service slugs when creating tasks", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "task_1", status: "queued" }));
    await new RunApiClient({ apiKey: "k", baseUrl: "https://runapi.ai" }, fetchImpl as any)
      .createTask("flux-kontext", "text_to_image", { prompt: "x" }, "opaque-task-key");

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://runapi.ai/api/v1/flux_kontext/text_to_image"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "opaque-task-key" }),
        body: JSON.stringify({ prompt: "x" })
      })
    );
  });

  it("rejects non-UUID task ids before sending an authenticated request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ balance_cents: 100 }));
    const client = new RunApiClient({ apiKey: "k", baseUrl: "https://runapi.ai" }, fetchImpl as any);

    await expect(client.getTask("gemini-tts", "../../me/balance", "text_to_speech"))
      .rejects.toThrow("taskId must be a canonical UUID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unsafe task route segments before sending an authenticated request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ balance_cents: 100 }));
    const client = new RunApiClient({ apiKey: "k", baseUrl: "https://runapi.ai" }, fetchImpl as any);
    const taskId = "550e8400-e29b-41d4-a716-446655440000";

    await expect(client.createTask("../me", "balance", {}, "unsafe-service"))
      .rejects.toThrow("service must be a valid route segment");
    await expect(client.getTask("gemini-tts", taskId, "../../me/balance"))
      .rejects.toThrow("action must be a valid route segment");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses a canonical task UUID as one encoded route segment", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "550e8400-e29b-41d4-a716-446655440000" }));
    const client = new RunApiClient({ apiKey: "k", baseUrl: "https://runapi.ai" }, fetchImpl as any);

    await client.getTask("gemini-tts", "550e8400-e29b-41d4-a716-446655440000", "text_to_speech");

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://runapi.ai/api/v1/gemini_tts/text_to_speech/550e8400-e29b-41d4-a716-446655440000"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("extracts task status and id from nested payloads", () => {
    expect(taskStatus({ data: { status: "COMPLETED" } })).toBe("completed");
    expect(taskIdFromResponse({ data: { task_id: "abc" } })).toBe("abc");
  });
});
