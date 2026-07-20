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

const RESERVED_DECLARED_FIELDS = new Set(["model"]);

// Union of every roster's fields for an action's advertised tool schema.
//
// Canonical fields share type/shape across models (ADR-0007); what diverges per
// model is the allowed value set and whether the field is required. So the
// advertised schema is the loosest envelope that accepts every model's valid
// input, and the per-model runtime check (validateParams against the resolved
// roster) does the precise enforcement:
//   - required: only when required in every roster (the safe intersection);
//     divergent-required fields stay optional here.
//   - enum: the union of every roster's values, but only when every roster that
//     defines the field constrains it — if any model leaves it free-form, the
//     field is advertised unconstrained. Otherwise the declared schema could
//     reject a value valid for one model before its runtime check runs.
//   - array item count: the loosest envelope across models for the advertised
//     schema; selected-model runtime validation enforces the precise roster.
//   - other constraints (type/min/max): first-seen, since canonical fields do
//     not diverge on those.
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
