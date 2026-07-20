import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createModelServer, type ModelServerTool } from "../src/server.js";
import type { RunApiClient } from "../src/runapi-client.js";
import { fixtureContract, fixturePricing, sunoInputRules } from "./fixtures.js";

const tools: ModelServerTool[] = [
  {
    name: "create_image",
    description: "Create an image with Flux Test.",
    service: "flux-test",
    action: "text_to_image",
    models: ["flux-test-pro"]
  },
  {
    name: "create_music",
    description: "Create music with Suno Test.",
    service: "suno-test",
    action: "text_to_music",
    models: ["suno-test"]
  },
  {
    name: "create_lyrics",
    description: "Generate lyrics with Suno Test.",
    service: "suno-test",
    action: "generate_lyrics",
    models: []
  },
  {
    name: "edit_image",
    description: "Edit an image with Seedream Test.",
    service: "seedream-test",
    action: "edit_image",
    models: ["seedream-test-quality", "seedream-test-resolution"]
  }
];

function mockClient() {
  const createTask = vi.fn(async () => ({ id: "task_1", status: "queued" }));
  const pollTask = vi.fn(async () => ({ id: "task_1", status: "completed" }));
  return { client: { createTask, pollTask } as unknown as RunApiClient, createTask, pollTask };
}

async function connect(client: RunApiClient, options: { authTools?: false } = {}) {
  const server = createModelServer({
    name: "@runapi.ai/flux-test",
    version: "1.2.3",
    lineSlug: "flux-test",
    contract: fixtureContract,
    pricing: fixturePricing,
    inputRules: sunoInputRules,
    tools,
    client,
    ...options
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

function parseText(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = (result.content as Array<{ type: string; text: string }>)[0];
  expect(content.type).toBe("text");
  return JSON.parse(content.text);
}

let mcpClient: Client | undefined;
afterEach(async () => {
  await mcpClient?.close();
  mcpClient = undefined;
});

describe("createModelServer", () => {
  it("registers the login tool and injected model tools by default", async () => {
    mcpClient = await connect(mockClient().client);
    const tools = await mcpClient.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["create_image", "create_lyrics", "create_music", "edit_image", "login"]);
  });

  it("publishes array cardinality as JSON Schema without narrowing model-specific limits", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);
    const listed = await mcpClient.listTools();
    const tool = listed.tools.find((candidate) => candidate.name === "edit_image");
    const field = (tool?.inputSchema.properties?.source_image_urls ?? {}) as Record<string, unknown>;

    expect(field).toMatchObject({ type: "array", minItems: 1, maxItems: 3 });

    const result = await mcpClient.callTool({
      name: "edit_image",
      arguments: {
        model: "seedream-test-quality",
        source_image_urls: ["a", "b", "c"],
        aspect_ratio: "1:1",
        output_quality: "high",
        wait: false
      }
    });
    expect(parseText(result).error).toContain("source_image_urls must contain between 1 and 2 items");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("can opt out of auth tools", async () => {
    mcpClient = await connect(mockClient().client, { authTools: false });
    const tools = await mcpClient.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["create_image", "create_lyrics", "create_music", "edit_image"]);
  });

  it("validates, creates a task via the injected client, and returns a price snapshot", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);

    const result = await mcpClient.callTool({ name: "create_image", arguments: { prompt: "a cat", wait: false } });
    const payload = parseText(result);

    expect(createTask).toHaveBeenCalledWith("flux-test", "text_to_image", { prompt: "a cat", model: "flux-test-pro" });
    expect(payload).toMatchObject({ task_id: "task_1", status: "queued" });
    expect(payload.price.pricing).toMatchObject({ unit_price_cents: 10 });
  });

  it("creates a no-model task without a model in the body and prices via the \"_\" key", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);

    const result = await mcpClient.callTool({ name: "create_lyrics", arguments: { prompt: "a ballad", wait: false } });
    const payload = parseText(result);

    expect(createTask).toHaveBeenCalledWith("suno-test", "generate_lyrics", { prompt: "a ballad" });
    expect(payload.error).toBeUndefined();
    expect(payload).toMatchObject({ task_id: "task_1", status: "queued" });
    expect(payload.price.pricing).toMatchObject({ unit_price_cents: 1 });
  });

  it("accepts a request that omits a field only its sibling model requires", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);

    const result = await mcpClient.callTool({
      name: "edit_image",
      arguments: { model: "seedream-test-resolution", source_image_urls: ["https://example.test/a.png"], wait: false }
    });
    const payload = parseText(result);

    expect(payload.error).toBeUndefined();
    expect(createTask).toHaveBeenCalledWith("seedream-test", "edit_image", {
      source_image_urls: ["https://example.test/a.png"],
      model: "seedream-test-resolution"
    });
    expect(payload).toMatchObject({ task_id: "task_1", status: "queued" });
  });

  it("rejects a request missing a field the selected model requires (divergent required)", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);

    const result = await mcpClient.callTool({
      name: "edit_image",
      arguments: { model: "seedream-test-quality", source_image_urls: ["https://example.test/a.png"], output_quality: "high", wait: false }
    });
    const payload = parseText(result);

    expect(payload.error).toBeDefined();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("rejects requests that violate the endpoint input rules without calling the client", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);

    const result = await mcpClient.callTool({ name: "create_music", arguments: { vocal_mode: "instrumental", wait: false } });
    const payload = parseText(result);

    expect(payload.error).toContain("requires style, title");
    expect(createTask).not.toHaveBeenCalled();
  });
});
