import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Contract, ContractField, RunApiTaskResponse } from "./types.js";
import { declaredFieldsForAction, findAction } from "./contract.js";
import { mcpZodObjectForFields } from "./schema.js";
import { RunApiClient, taskIdFromResponse, taskStatus } from "./runapi-client.js";
import { friendlyError } from "./errors.js";
import { jsonText } from "./tool-response.js";
import { registerLoginTool, type LoginDependencies } from "./login.js";

export type ModelServerTool = {
  name: string;
  description: string;
  service: string;
  action: string;
  models: string[];
};

export type CreateModelServerOptions = {
  name: string;
  version: string;
  lineSlug: string;
  contract: Contract;
  tools: ModelServerTool[];
  // Additive optional injection beyond the base field set:
  // lets tests pass a mock and lets a per-model server pass a pre-configured
  // client. Callers do not need to supply these.
  client?: RunApiClient;
  instructions?: string;
  authTools?: false | LoginDependencies;
};

// Builds a per-model RunAPI MCP server from injected catalog data — no disk
// access. API parameters are forwarded unchanged; RunAPI validates them.
export function createModelServer(options: CreateModelServerOptions): McpServer {
  const { name, version, lineSlug, contract, tools, client = new RunApiClient() } = options;

  const server = new McpServer(
    {
      name,
      version
    },
    {
      instructions: options.instructions ?? defaultInstructions(lineSlug),
      capabilities: {
        tools: {},
        logging: {}
      }
    }
  );

  if (options.authTools !== false) {
    registerLoginTool(server, typeof options.authTools === "object" ? options.authTools : undefined);
  }

  for (const tool of tools) {
    const action = findAction(tool.service, tool.action, contract);
    const declaredFields = action ? declaredFieldsForAction(action) : {};
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: toolSchema(declaredFields, tool.models)
    }, async (args, extra) => {
      const { wait = true, timeout_ms, poll_interval_ms, model, ...params } = args as Record<string, unknown> & {
        wait?: boolean;
        timeout_ms?: number;
        poll_interval_ms?: number;
        model?: string;
      };

      try {
        // Preserve explicit future models and use the known default only when
        // omitted. Endpoints with no model roster never send a model.
        const selectedModel = tool.models.length > 0 ? model ?? tool.models[0] : undefined;
        const body = {
          ...params,
          ...(selectedModel === undefined ? {} : { model: selectedModel })
        };

        const created = await client.createTask(tool.service, tool.action, body, undefined, action?.path);
        const taskId = taskIdFromResponse(created);

        if (!wait || !taskId) {
          return jsonText({
            created,
            task_id: taskId,
            status: taskStatus(created)
          });
        }

        const timeout = timeout_ms ?? defaultTimeout(tool.action);
        const startedAt = Date.now();
        const completed = await client.pollTask(tool.service, taskId, tool.action, {
          timeoutMs: timeout,
          intervalMs: poll_interval_ms ?? 5_000,
          onProgress: async (task: RunApiTaskResponse) => {
            const elapsed = Date.now() - startedAt;
            await extra.sendNotification?.({
              method: "notifications/progress",
              params: {
                progressToken: extra._meta?.progressToken ?? taskId,
                progress: Math.min(elapsed, timeout),
                total: timeout,
                message: `RunAPI task ${taskId}: ${taskStatus(task)}`
              }
            });
          }
        }, { route: action?.path });

        return jsonText({
            task_id: taskId,
            status: taskStatus(completed),
            result: completed
        });
      } catch (error) {
        return jsonText({ error: friendlyError(error) });
      }
    });
  }

  return server;
}

function toolSchema(fields: Record<string, ContractField>, models: string[]): z.ZodObject<any> {
  const extras: Record<string, z.ZodType<any, any>> = {
    wait: z.boolean().default(true).describe("Poll until the task reaches a terminal status."),
    timeout_ms: z.number().int().positive().optional(),
    poll_interval_ms: z.number().int().positive().optional()
  };

  if (models.length > 0) {
    extras.model = z.unknown().optional().meta({ type: "string" }).describe("RunAPI model slug for this model line.");
  }

  return mcpZodObjectForFields(fields, extras);
}

export function defaultTimeout(action: string): number {
  if (action.includes("video")) {
    return 300_000;
  }
  if (["music", "audio", "speech", "sound", "voice"].some((term) => action.includes(term))) {
    return 300_000;
  }
  if (action.includes("image")) {
    return 120_000;
  }
  return 30_000;
}

function defaultInstructions(lineSlug: string): string {
  return [
    `RunAPI MCP server for the ${lineSlug} model line.`,
    "",
    "Each tool creates a RunAPI media task and optionally polls until completion.",
    "Behavior:",
    "1. Use the user's language and be concise.",
    "2. Confirm before expensive, long-running, or batch requests.",
    "3. Present results as task ID, status, output URLs, and cost fields when available.",
    "4. Do not describe generated media as if you inspected it.",
    "5. On an API key error, call the login tool for interactive browser auth; headless hosts can use RUNAPI_API_KEY or ~/.config/runapi/config.json."
  ].join("\n");
}
