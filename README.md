# RunAPI MCP Core

Reusable TypeScript primitives for building RunAPI Model Context Protocol servers.

`@runapi.ai/mcp-core` is the shared library used by the aggregate RunAPI MCP server and the per-model-line MCP servers. It provides the RunAPI HTTP client, contract helpers, pricing lookup, input validation, tool response helpers, and `createModelServer` for turning embedded RunAPI catalog data into MCP tools.

This package is a library. If you want a ready-to-run MCP server, use one of these packages instead:

- `@runapi.ai/mcp` for the full RunAPI catalog.
- `@runapi.ai/<model-line>-mcp` for a focused model-line server.

## Installation

```bash
npm install @runapi.ai/mcp-core
```

Node.js 22 or newer is required.

## What It Includes

| Export area | Purpose |
|---|---|
| `RunApiClient` | Create tasks, fetch tasks, poll tasks, list models, search prompts, and check balance through the RunAPI API. |
| `createModelServer` | Build an MCP server from embedded contract, pricing, and tool metadata. |
| Contract helpers | Resolve actions, models, fields, declared tool schemas, and action groups. |
| Pricing helpers | Look up embedded final pricing snapshots for a model/action pair. |
| Schema helpers | Convert RunAPI contract fields into Zod shapes and validate request params. |
| Input rules | Validate endpoint-level cross-field requirements before creating a task. |
| Response helpers | Format JSON MCP tool responses and friendly errors. |

## Basic Usage

```ts
import {
  RunApiClient,
  createModelServer,
  type Contract,
  type PricingConfig,
  type ModelServerTool
} from "@runapi.ai/mcp-core";

const contract: Contract = {
  catalog_models: ["example-model"],
  actions: {
    "example/text_to_image": {
      model: "example",
      endpoint: "text_to_image",
      models: ["example-model"],
      fields_by_model: {
        "example-model": {
          prompt: {
            type: "string",
            required: true,
            description: "Image prompt."
          }
        }
      }
    }
  }
};

const pricing: PricingConfig = {
  endpoints: {}
};

const tools: ModelServerTool[] = [
  {
    name: "text_to_image",
    description: "Create an example image task on RunAPI.",
    service: "example",
    action: "text_to_image",
    models: ["example-model"]
  }
];

const server = createModelServer({
  name: "@runapi.ai/example-mcp",
  version: "0.1.0",
  lineSlug: "example",
  contract,
  pricing,
  inputRules: {},
  tools,
  client: new RunApiClient()
});
```

Connect the returned server with an MCP transport, for example `StdioServerTransport` from `@modelcontextprotocol/sdk`.

## Authentication

Authenticated RunAPI calls resolve auth in this order:

1. `RUNAPI_API_KEY`, useful for headless and CI hosts.
2. `~/.config/runapi/config.json`, created by the MCP `login` tool or `runapi login`.

Headless hosts can set:

```bash
export RUNAPI_API_KEY=your_key_here
```

`RunApiClient` also accepts an injected config object and `fetch` implementation for tests or custom hosts.

## Safe Task Creation

Pass a caller-generated opaque idempotency key when creating a task. Generate one key per logical task and reuse it only when retrying the exact same request after an unknown result. The key is sent as the public `Idempotency-Key` request header and is not added to the JSON body.

```ts
const task = await client.createTask(
  "example",
  "text_to_image",
  {model: "example-model", prompt: "A product photo"},
  "opaque-logical-task-1"
);
```

Do not derive the key from a JSON-RPC request ID or `X-Client-Request-Id`, and do not reuse it with different input.

## Package Design

`@runapi.ai/mcp-core` does not read catalog or pricing files at runtime. Server packages pass their embedded contract and pricing JSON into the library, which keeps published MCP packages deterministic and easy to smoke test.

The package is ESM-only and ships TypeScript declarations.

## Links

- RunAPI: https://runapi.ai
- Full MCP server: https://www.npmjs.com/package/@runapi.ai/mcp
- GitHub: https://github.com/runapi-ai/mcp-core
- npm: https://www.npmjs.com/package/@runapi.ai/mcp-core
- License: Apache-2.0
