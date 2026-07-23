import { USER_AGENT } from "./constants.js";
import { loadConfig, requireApiKey, type RunApiConfig } from "./config.js";
import type { PollingOptions, RunApiPromptsResponse, RunApiTaskResponse, SearchPromptsParams } from "./types.js";
import { errorFromResponse, PollTimeoutError } from "./errors.js";
import { taskStatus } from "./task.js";

export { taskIdFromResponse, taskStatus } from "./task.js";

type RequestOptions = {
  auth?: boolean;
  body?: unknown;
  headers?: Record<string, string>;
};

type RunApiConfigSource = RunApiConfig | (() => RunApiConfig);

const COMPLETED_STATUSES = new Set(["completed", "complete", "succeeded", "success", "finished"]);
const FAILED_STATUSES = new Set(["failed", "error", "canceled", "cancelled", "timeout"]);
const TASK_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export class RunApiClient {
  constructor(
    private readonly configSource: RunApiConfigSource = loadConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly userAgent: string = USER_AGENT
  ) {}

  async listModels() {
    return this.request("GET", "/v1/models", { auth: false });
  }

  async searchPrompts(params: SearchPromptsParams = {}) {
    const query = new URLSearchParams();
    appendQuery(query, "modality", params.modality);
    appendQuery(query, "category", params.category);
    appendQuery(query, "tags", params.tags?.join(","));
    appendQuery(query, "q", params.q);
    appendQuery(query, "model", params.model);
    appendQuery(query, "featured", params.featured);
    appendQuery(query, "page", params.page);
    appendQuery(query, "per_page", params.per_page);

    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<RunApiPromptsResponse>("GET", `/api/v1/prompts${suffix}`, { auth: false });
  }

  async balance() {
    return this.request("GET", "/api/v1/me/balance", { auth: true });
  }

  async createTask(service: string, action: string, params: Record<string, unknown>) {
    return this.request<RunApiTaskResponse>("POST", `/api/v1/${routeServiceSlug(service)}/${action}`, {
      auth: true,
      body: params
    });
  }

  async getTask(service: string, taskId: string, action?: string) {
    const routeService = routeServiceSlug(service);
    const encodedTaskId = taskIdPathSegment(taskId);
    const path = action ? `/api/v1/${routeService}/${action}/${encodedTaskId}` : `/api/v1/${routeService}/${encodedTaskId}`;
    return this.request<RunApiTaskResponse>("GET", path, {
      auth: true
    });
  }

  async pollTask(service: string, taskId: string, action?: string, options: PollingOptions = {}) {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const intervalMs = options.intervalMs ?? 5_000;
    const startedAt = Date.now();
    let lastTask: RunApiTaskResponse | undefined;

    while (Date.now() - startedAt < timeoutMs) {
      const task = await this.getTask(service, taskId, action);
      lastTask = task;
      await options.onProgress?.(task);

      const status = taskStatus(task);
      if (COMPLETED_STATUSES.has(status) || FAILED_STATUSES.has(status)) {
        return task;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new PollTimeoutError(`Timed out waiting for RunAPI task ${taskId}. Last status: ${taskStatus(lastTask)}.`);
  }

  private async request<T = unknown>(method: string, requestPath: string, options: RequestOptions = {}): Promise<T> {
    const config = this.config();
    const url = new URL(requestPath, config.baseUrl.replace(/\/+$/, ""));
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": this.userAgent,
      ...options.headers
    };

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (options.auth !== false) {
      headers.authorization = `Bearer ${requireApiKey(config)}`;
    }

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return await response.json() as T;
  }

  private config(): RunApiConfig {
    return typeof this.configSource === "function" ? this.configSource() : this.configSource;
  }
}

function routeServiceSlug(service: string): string {
  return service.replace(/-/g, "_");
}

function taskIdPathSegment(taskId: string): string {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new TypeError("taskId must be a canonical UUID");
  }

  return encodeURIComponent(taskId);
}

function appendQuery(query: URLSearchParams, key: string, value: string | number | boolean | undefined) {
  if (value === undefined || value === "") {
    return;
  }

  query.set(key, String(value));
}
