export type ContractField = {
  required?: boolean;
  enum?: unknown[];
  default?: unknown;
  min?: number;
  max?: number;
  minimum?: number;
  maximum?: number;
  // When true, min/max are string-length bounds rather than numeric value bounds.
  length?: boolean;
  type?: string | string[];
  description?: string;
  pattern?: string;
  min_items?: number;
  max_items?: number;
  items?: ContractField;
  properties?: Record<string, ContractField>;
  additionalProperties?: boolean;
};

export type ContractAction = {
  model: string;
  endpoint: string;
  models: string[];
  task_type?: "synchronous" | "asynchronous";
  // The action's public route when it is not `/api/v1/<service>/<endpoint>` —
  // a provider-neutral resource is published at the API root instead.
  path?: string;
  fields_by_model: Record<string, Record<string, ContractField>>;
};

export type Contract = {
  actions: Record<string, ContractAction>;
  retired_models?: Record<string, {
    provider: string;
    versions: { id: string; retired_at?: string; replacement?: string }[];
  }>;
};

export type ModelInfo = {
  service: string;
  action: string;
  route_action: string;
  model_line: string;
  // Undefined for no-model endpoints (contract actions with models: []).
  model?: string;
  fields: Record<string, ContractField>;
};

export type RunApiTaskResponse = {
  id?: string;
  task_id?: string;
  status?: string;
  state?: string;
  data?: unknown;
  result?: unknown;
  output?: unknown;
  outputs?: unknown;
  url?: string;
  urls?: string[];
  cost_cents?: number;
  amount_cents?: number;
  [key: string]: unknown;
};

export type SearchPromptsParams = {
  modality?: string;
  category?: string;
  tags?: string[];
  q?: string;
  model?: string;
  page?: number;
  per_page?: number;
};

export type RunApiPromptEndpoint = {
  service: string;
  action: string;
  model: string;
  path: string;
};

export type RunApiPrompt = {
  id: string;
  title?: string | null;
  prompt: string;
  negative_prompt?: string | null;
  language?: string | null;
  modality?: string | null;
  input_kind?: string | null;
  category?: string | null;
  tags?: string[];
  preview_url?: string | null;
  source_url?: string | null;
  published_at?: string | null;
  eligible_endpoints: RunApiPromptEndpoint[];
};

export type RunApiPromptsResponse = {
  prompts: RunApiPrompt[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    pages: number;
  };
};

export type PollingOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  onProgress?: (task: RunApiTaskResponse) => Promise<void> | void;
};

// Context for looking up one task: the action's public route when the contract
// publishes one, and the caller's cancellation signal.
export type TaskLookupOptions = {
  route?: string;
  signal?: AbortSignal;
};
