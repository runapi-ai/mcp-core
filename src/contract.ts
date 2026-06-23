import type { Contract, ContractAction, ContractField, ModelInfo } from "./types.js";
import { contractKey, modalityForAction, routeAction } from "./text.js";

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
  if (direct) {
    return direct;
  }

  return Object.entries(source.actions).find(([key, value]) => {
    const [candidateService] = key.split("/");
    return candidateService === service && value.endpoint === action;
  })?.[1];
}

export function findModel(model: string, source: Contract): ModelInfo | undefined {
  return listContractModels(source).find((entry) => entry.model === model);
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

export function fieldSummary(fields: Record<string, ContractField>) {
  return Object.entries(fields).map(([name, field]) => ({
    name,
    required: Boolean(field.required),
    enum: field.enum,
    default: field.default,
    min: field.min ?? field.minimum,
    max: field.max ?? field.maximum,
    type: field.type
  }));
}
