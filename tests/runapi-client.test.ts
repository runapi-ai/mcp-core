import { describe, expect, it, vi } from "vitest";
import { USER_AGENT } from "../src/constants.js";
import { RunApiClient, taskIdFromResponse, taskStatus } from "../src/runapi-client.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("RunApiClient", () => {
  it("sends the core User-Agent by default", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    await new RunApiClient({ baseUrl: "https://runapi.ai" }, fetchImpl as any).listModels();

    expect(USER_AGENT).toBe("@runapi.ai/mcp-core/0.1.4");
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

  it("normalizes service slugs when creating tasks", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "task_1", status: "queued" }));
    await new RunApiClient({ apiKey: "k", baseUrl: "https://runapi.ai" }, fetchImpl as any)
      .createTask("flux-kontext", "text_to_image", { prompt: "x" });

    expect(fetchImpl).toHaveBeenCalledWith(new URL("https://runapi.ai/api/v1/flux_kontext/text_to_image"), expect.objectContaining({ method: "POST" }));
  });

  it("extracts task status and id from nested payloads", () => {
    expect(taskStatus({ data: { status: "COMPLETED" } })).toBe("completed");
    expect(taskIdFromResponse({ data: { task_id: "abc" } })).toBe("abc");
  });
});
