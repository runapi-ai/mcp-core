import { USER_AGENT } from "./constants.js";
import { loadConfig, requireApiKey, type RunApiConfig } from "./config.js";
import type { PollingOptions, RunApiPromptsResponse, RunApiTaskResponse, SearchPromptsParams, TaskLookupOptions } from "./types.js";
import { errorFromResponse, PollTimeoutError } from "./errors.js";
import { actionRoutePath } from "./contract.js";
import { taskStatus } from "./task.js";

export { taskIdFromResponse, taskStatus } from "./task.js";

type RequestOptions = {
  auth?: boolean | "optional";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type RequestSignalOptions = Pick<RequestOptions, "signal">;

type RunApiConfigSource = RunApiConfig | (() => RunApiConfig);

const COMPLETED_STATUSES = new Set(["completed", "complete", "succeeded", "success", "finished"]);
const FAILED_STATUSES = new Set(["failed", "error", "canceled", "cancelled", "timeout"]);
const ROUTE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
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

  async listPriceSchedules(filters: PriceScheduleFilters = {}, options: RequestSignalOptions = {}) {
    const query = new URLSearchParams();
    appendQuery(query, "service", filters.service?.replace(/-/g, "_"));
    appendQuery(query, "action", filters.action);
    appendQuery(query, "model", filters.model);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";

    return this.request<PriceSchedulesResponse>("GET", `/api/v1/price_schedules${suffix}`, {
      auth: "optional",
      signal: options.signal
    });
  }

  async quotePrice(input: PriceQuoteInput, options: RequestSignalOptions = {}) {
    return this.request<PriceQuoteResponse>("POST", "/api/v1/price_quotes", {
      auth: "optional",
      body: input,
      signal: options.signal
    });
  }

  async createTask(
    service: string,
    action: string,
    params: Record<string, unknown>,
    idempotencyKey?: string,
    route?: string
  ) {
    const response = await this.createTaskResponse(service, action, params, idempotencyKey, route);
    return this.responseJson<RunApiTaskResponse>(response);
  }

  async createTaskResponse(
    service: string,
    action: string,
    params: Record<string, unknown>,
    idempotencyKey?: string,
    route?: string
  ) {
    const path = route
      ? actionRoutePath(route)
      : `/api/v1/${routeServiceSlug(service)}/${routePathSegment(action, "action")}`;
    return this.requestResponse("POST", path, {
      auth: true,
      body: params,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined
    });
  }

  async getTaskResultResponse(location: string, options: RequestSignalOptions = {}) {
    const config = this.config();
    const baseUrl = new URL(config.baseUrl);
    const resultUrl = new URL(location, baseUrl);
    if (resultUrl.origin !== baseUrl.origin) {
      throw new Error("RunAPI Task Result Location was invalid");
    }

    return this.requestResponse("GET", resultUrl, {auth: true, signal: options.signal});
  }

  async getTask(service: string, taskId: string, action?: string, options: TaskLookupOptions = {}) {
    const routeService = routeServiceSlug(service);
    const encodedTaskId = taskIdPathSegment(taskId);
    const path = options.route
      ? actionRoutePath(options.route, encodedTaskId)
      : action
        ? `/api/v1/${routeService}/${routePathSegment(action, "action")}/${encodedTaskId}`
        : `/api/v1/${routeService}/${encodedTaskId}`;
    return this.request<RunApiTaskResponse>("GET", path, {
      auth: true,
      signal: options.signal
    });
  }

  async pollTask(
    service: string,
    taskId: string,
    action?: string,
    options: PollingOptions = {},
    lookup: TaskLookupOptions = {}
  ) {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const intervalMs = options.intervalMs ?? 5_000;
    const startedAt = Date.now();
    let lastTask: RunApiTaskResponse | undefined;

    while (Date.now() - startedAt < timeoutMs) {
      const task = await this.getTask(service, taskId, action, lookup);
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
    return this.responseJson<T>(await this.requestResponse(method, requestPath, options));
  }

  private async requestResponse(method: string, requestPath: string | URL, options: RequestOptions = {}): Promise<Response> {
    const config = this.config();
    const url = requestPath instanceof URL ? requestPath : new URL(requestPath, config.baseUrl.replace(/\/+$/, ""));
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": this.userAgent,
      ...options.headers
    };

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (options.auth !== false && (options.auth !== "optional" || config.apiKey)) {
      headers.authorization = `Bearer ${requireApiKey(config)}`;
    }

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }

    return response;
  }

  private async responseJson<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
    }

    return await response.json() as T;
  }

  private config(): RunApiConfig {
    return typeof this.configSource === "function" ? this.configSource() : this.configSource;
  }
}

export type PriceScheduleFilters = {
  service?: string;
  action?: string;
  model?: string;
};

export type PriceQuoteInput = Required<Pick<PriceScheduleFilters, "service" | "action">> & {
  model?: string;
  params?: Record<string, unknown>;
};

export type PriceSchedulesResponse = {
  as_of: string;
  price_schedules: Array<Record<string, unknown>>;
};

export type PriceQuoteResponse = {
  price_quote: Record<string, unknown>;
};

function routeServiceSlug(service: string): string {
  return routePathSegment(service.replace(/-/g, "_"), "service");
}

function routePathSegment(value: string, name: "service" | "action"): string {
  if (!ROUTE_SEGMENT_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a valid route segment`);
  }

  return value;
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
