import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Contract, ContractField, InputRule, PricingConfig, RunApiTaskResponse } from "./types.js";
import { declaredFieldsForAction, findAction, findModelForAction } from "./contract.js";
import { priceForModel } from "./pricing.js";
import { validateInputRules } from "./input-rules.js";
import { validateParams, zodShapeForFields } from "./schema.js";
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
  pricing: PricingConfig;
  inputRules: Record<string, InputRule[]>;
  tools: ModelServerTool[];
  // Additive optional injection beyond the agreed API-696/697/698 field set:
  // lets tests pass a mock and lets a per-model server pass a pre-configured
  // client. API-698 does not need to supply these.
  client?: RunApiClient;
  instructions?: string;
  authTools?: false | LoginDependencies;
};

// Builds a per-model RunAPI MCP server from injected catalog data — no disk
// access. Each tool creates and optionally polls a RunAPI task for its
// service/action, validating params against the tool's inputSchema and the
// endpoint's cross-field input rules.
export function createModelServer(options: CreateModelServerOptions): McpServer {
  const { name, version, lineSlug, contract, pricing, inputRules, tools, client = new RunApiClient() } = options;

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
    server.tool(tool.name, tool.description, toolShape(declaredFields, tool.models), async (args, extra) => {
      const { wait = true, timeout_ms, poll_interval_ms, model, ...params } = args as Record<string, unknown> & {
        wait?: boolean;
        timeout_ms?: number;
        poll_interval_ms?: number;
        model?: string;
      };

      try {
        const info = findModelForAction(tool.service, tool.action, model, contract);
        if (!info) {
          return jsonText({
            error: "Unsupported RunAPI service/action/model combination.",
            hint: "This model server was generated for a specific model line; verify the requested model."
          });
        }

        // Validate against the resolved model's own field roster so divergent
        // per-model required fields are enforced correctly (the advertised tool
        // schema declares the union with required relaxed to the intersection).
        // Send the resolved model (explicit arg or the line's default) so
        // model-optional create calls still satisfy endpoints that require it.
        // No-model endpoints (models: []) resolve without a model — omit it.
        const body = validateParams(info.fields, {
          ...params,
          ...(info.model ? { model: info.model } : {})
        });

        const ruleError = validateInputRules(inputRules[tool.action] ?? [], body);
        if (ruleError) {
          return jsonText({
            error: `Invalid RunAPI parameters: ${ruleError}`,
            hint: "Adjust the parameters to satisfy the endpoint input rules before retrying."
          });
        }

        const price = priceForModel(info, pricing);
        const created = await client.createTask(tool.service, tool.action, body);
        const taskId = taskIdFromResponse(created);

        if (!wait || !taskId) {
          return jsonText({
            created,
            task_id: taskId,
            status: taskStatus(created),
            price
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
        });

        return jsonText({
          task_id: taskId,
          status: taskStatus(completed),
          result: completed,
          price
        });
      } catch (error) {
        return jsonText({ error: friendlyError(error) });
      }
    });
  }

  return server;
}

function toolShape(fields: Record<string, ContractField>, models: string[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {
    ...zodShapeForFields(fields),
    wait: z.boolean().default(true).describe("Poll until the task reaches a terminal status."),
    timeout_ms: z.number().int().positive().optional(),
    poll_interval_ms: z.number().int().positive().optional()
  };

  if (models.length > 0) {
    shape.model = z.enum(models as [string, ...string[]]).optional().describe("RunAPI model slug for this model line.");
  }

  return shape;
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
