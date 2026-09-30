import type { Contract, ContractAction, ContractField, ModelInfo } from "./types.js";
import { contractKey, modalityForAction, routeAction } from "./text.js";

const ACTION_ROUTE_PATTERN = /^\/api\/v1(?:\/[A-Za-z0-9_-]+)+$/;

export function listContractModels(source: Contract): ModelInfo[] {
  return Object.entries(source.actions).flatMap(([key, action]) => {
    const [service, actionSlug] = key.split("/");
    return action.models.map((model) => ({
      service,
      action: action.endpoint,
      route_action: routeAction(actionSlug),
      model_line: action.model,
      model,
      fields: fieldsForModel(action, model)
    }));
  });
}

export function listActionGroups(source: Contract) {
  const groups = new Map<string, Set<string>>();

  for (const action of Object.values(source.actions)) {
    const modality = modalityForAction(action.endpoint);
    if (!groups.has(modality)) {
      groups.set(modality, new Set());
    }
    groups.get(modality)?.add(action.endpoint);
  }

  return [...groups.entries()].map(([modality, actions]) => ({
    modality,
    actions: [...actions].sort()
  }));
}

export function findAction(service: string, action: string, source: Contract): ContractAction | undefined {
  const direct = source.actions[contractKey(service, action)];
  const candidates = Object.entries(source.actions)
    .filter(([key, value]) => key.split("/", 1)[0] === service && value.endpoint === action)
    .map(([, value]) => value);
  const entries = direct ? [direct, ...candidates.filter((candidate) => candidate !== direct)] : candidates;

  // An endpoint can carry both a deprecated operation and the provider-neutral
  // resource that replaced it; only the resource publishes a public route and
  // accepts the canonical fields, so it is the action this endpoint resolves to.
  return entries.find((candidate) => candidate.path) ?? entries[0];
}

export function findModel(model: string, source: Contract): ModelInfo | undefined {
  return listContractModels(source).find((entry) => entry.model === model);
}

// A contract action may publish its own public route: a provider-neutral
// resource lives at the API root rather than under its service slug. The route
// is validated so a malformed contract cannot escape `/api/v1`.
export function actionRoutePath(route: string, taskIdSegment?: string): string {
  const path = route.replace(/\/+$/, "");
  if (!ACTION_ROUTE_PATTERN.test(path)) {
    throw new TypeError("route must be a valid /api/v1 path");
  }

  return taskIdSegment ? `${path}/${taskIdSegment}` : path;
}

export function findModels(model: string, source: Contract): ModelInfo[] {
  return listContractModels(source).filter((entry) => entry.model === model);
}

export function findModelForAction(service: string, action: string, model: string | undefined, source: Contract): ModelInfo | undefined {
  const entry = findAction(service, action, source);
  if (!entry) {
    return undefined;
  }

  // No-model endpoints (models: []) carry their fields under the "_" roster and
  // resolve to a ModelInfo with no model slug.
  if (entry.models.length === 0) {
    return {
      service,
      action: entry.endpoint,
      route_action: entry.endpoint,
      model_line: entry.model,
      model: undefined,
      fields: fieldsForModel(entry, "_")
    };
  }

  const selectedModel = model || entry.models[0];
  if (!entry.models.includes(selectedModel)) {
    return undefined;
  }

  return {
    service,
    action: entry.endpoint,
    route_action: entry.endpoint,
    model_line: entry.model,
    model: selectedModel,
    fields: fieldsForModel(entry, selectedModel)
  };
}

export function fieldsForModel(action: ContractAction, model: string): Record<string, ContractField> {
  return action.fields_by_model[model] || action.fields_by_model._ || {};
}

const RESERVED_DECLARED_FIELDS = new Set(["model"]);

// Union of known field metadata for tool guidance. The schema builders expose
// it descriptively; RunAPI remains the sole authority for input validation.
export function declaredFieldsForAction(action: ContractAction): Record<string, ContractField> {
  const rosters = action.models.length > 0 ? action.models : ["_"];
  const defsByName = new Map<string, ContractField[]>();
  const order: string[] = [];
  for (const roster of rosters) {
    for (const [name, field] of Object.entries(fieldsForModel(action, roster))) {
      if (RESERVED_DECLARED_FIELDS.has(name)) {
        continue;
      }
      if (!defsByName.has(name)) {
        defsByName.set(name, []);
        order.push(name);
      }
      defsByName.get(name)!.push(field);
    }
  }

  const merged: Record<string, ContractField> = {};
  for (const name of order) {
    const defs = defsByName.get(name)!;
    const field: ContractField = { ...defs[0] };

    if (defs.every((def) => def.enum?.length)) {
      field.enum = Array.from(new Set(defs.flatMap((def) => def.enum!)));
    } else {
      delete field.enum;
    }

    field.required = rosters.every((roster) => fieldsForModel(action, roster)[name]?.required === true);
    const minItems = rosters.map((roster) => fieldsForModel(action, roster)[name]?.min_items);
    if (minItems.every((value): value is number => typeof value === "number")) {
      field.min_items = Math.min(...minItems);
    } else {
      delete field.min_items;
    }
    const maxItems = rosters.map((roster) => fieldsForModel(action, roster)[name]?.max_items);
    if (maxItems.every((value): value is number => typeof value === "number")) {
      field.max_items = Math.max(...maxItems);
    } else {
      delete field.max_items;
    }
    merged[name] = field;
  }
  return merged;
}

export function fieldSummary(fields: Record<string, ContractField>) {
  return Object.entries(fields).map(([name, field]) => ({
    name,
    required: Boolean(field.required),
    enum: field.enum,
    default: field.default,
    min: field.min ?? field.minimum,
    max: field.max ?? field.maximum,
    min_items: field.min_items,
    max_items: field.max_items,
    type: field.type
  }));
}
