import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zodShapeForFields } from "../src/schema.js";
import { createModelServer, type ModelServerTool } from "../src/server.js";
import type { RunApiClient } from "../src/runapi-client.js";
import { fixtureContract, sunoInputRules } from "./fixtures.js";

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
    name: "visualize_music",
    description: "Visualize music with Suno Test.",
    service: "suno-test",
    action: "visualize_music",
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
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["create_image", "create_lyrics", "create_music", "edit_image", "login", "visualize_music"]);
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
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["create_image", "create_lyrics", "create_music", "edit_image", "visualize_music"]);
  });

  it("validates and creates a task without attaching pricing data", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);

    const result = await mcpClient.callTool({ name: "create_image", arguments: { prompt: "a cat", wait: false } });
    const payload = parseText(result);

    expect(createTask).toHaveBeenCalledWith("flux-test", "text_to_image", { prompt: "a cat", model: "flux-test-pro" }, undefined, undefined);
    expect(payload).toMatchObject({ task_id: "task_1", status: "queued" });
    expect(payload.price).toBeUndefined();
  });

  it("creates a no-model task without a model in the body", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);

    const result = await mcpClient.callTool({ name: "create_lyrics", arguments: { prompt: "ok", wait: false } });
    const payload = parseText(result);

    expect(createTask).toHaveBeenCalledWith("suno-test", "generate_lyrics", { prompt: "ok" }, undefined, undefined);
    expect(payload.error).toBeUndefined();
    expect(payload).toMatchObject({ task_id: "task_1", status: "queued" });
    expect(payload.price).toBeUndefined();
  });

  it("publishes code-point string limits and accepts astral characters within them", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);
    const listed = await mcpClient.listTools();
    const tool = listed.tools.find((candidate) => candidate.name === "create_lyrics");
    const field = (tool?.inputSchema.properties?.prompt ?? {}) as Record<string, unknown>;

    expect(field).toMatchObject({ type: "string", maxLength: 2 });

    const result = await mcpClient.callTool({
      name: "create_lyrics",
      arguments: { prompt: "😀😀", wait: false }
    });
    expect(parseText(result).error).toBeUndefined();
    expect(createTask).toHaveBeenCalledWith("suno-test", "generate_lyrics", { prompt: "😀😀" }, undefined, undefined);
  });

  it("preserves JSON Schema length metadata for the public Zod 3 shape builder", async () => {
    const server = new McpServer({ name: "legacy-shape-test", version: "0.0.0" });
    server.tool(
      "legacy_shape",
      zodShapeForFields({ prompt: { type: "string", length: true, max: 2 } }),
      async () => ({ content: [{ type: "text" as const, text: "ok" }] })
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcpClient = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const listed = await mcpClient.listTools();
    expect(listed.tools[0]?.inputSchema.properties?.prompt).toMatchObject({ type: "string", maxLength: 2 });
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
    }, undefined, undefined);
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

  it("creates and polls on an action's public route when the contract publishes one", async () => {
    const { client, createTask, pollTask } = mockClient();
    mcpClient = await connect(client);

    const created = await mcpClient.callTool({ name: "visualize_music", arguments: { source_audio_id: "audio_1", wait: false } });
    expect(parseText(created).error).toBeUndefined();
    expect(createTask).toHaveBeenCalledWith("suno-test", "visualize_music", { source_audio_id: "audio_1" }, undefined, "/api/v1/music_visualizations");

    await mcpClient.callTool({ name: "visualize_music", arguments: { source_audio_id: "audio_1" } });
    expect(pollTask).toHaveBeenCalledWith("suno-test", "task_1", "visualize_music", expect.objectContaining({ intervalMs: 5_000 }), { route: "/api/v1/music_visualizations" });
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
