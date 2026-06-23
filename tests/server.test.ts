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
    models: ["flux-test-pro"],
    inputSchema: { prompt: { required: true, type: "string" }, steps: { type: "integer", min: 1, max: 50 } }
  },
  {
    name: "create_music",
    description: "Create music with Suno Test.",
    service: "suno-test",
    action: "text_to_music",
    models: ["suno-test"],
    inputSchema: fixtureContract.actions["suno-test/text-to-music"].fields_by_model["suno-test"]
  },
  {
    name: "create_lyrics",
    description: "Generate lyrics with Suno Test.",
    service: "suno-test",
    action: "generate_lyrics",
    models: [],
    inputSchema: fixtureContract.actions["suno-test/generate-lyrics"].fields_by_model["_"]
  }
];

function mockClient() {
  const createTask = vi.fn(async () => ({ id: "task_1", status: "queued" }));
  const pollTask = vi.fn(async () => ({ id: "task_1", status: "completed" }));
  return { client: { createTask, pollTask } as unknown as RunApiClient, createTask, pollTask };
}

async function connect(client: RunApiClient) {
  const server = createModelServer({
    name: "@runapi.ai/flux-test",
    version: "1.2.3",
    lineSlug: "flux-test",
    contract: fixtureContract,
    pricing: fixturePricing,
    inputRules: sunoInputRules,
    tools,
    client
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
  it("registers exactly the injected tools", async () => {
    mcpClient = await connect(mockClient().client);
    const tools = await mcpClient.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["create_image", "create_lyrics", "create_music"]);
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

  it("rejects requests that violate the endpoint input rules without calling the client", async () => {
    const { client, createTask } = mockClient();
    mcpClient = await connect(client);

    const result = await mcpClient.callTool({ name: "create_music", arguments: { vocal_mode: "instrumental", wait: false } });
    const payload = parseText(result);

    expect(payload.error).toContain("requires style, title");
    expect(createTask).not.toHaveBeenCalled();
  });
});
