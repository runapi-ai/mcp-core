import { findAction } from "./contract.js";
import type { Contract, InputRule, ModelInfo } from "./types.js";

export type { InputRule } from "./types.js";

export function inputRulesForModel(
  info: Pick<ModelInfo, "service" | "action">,
  contract: Contract
): InputRule[] {
  return (findAction(info.service, info.action, contract)?.rules ?? []).map((rule) => ({
    ...rule,
    when: rule.when ?? {},
    required: rule.required ?? [],
    required_any: rule.required_any ?? [],
    forbidden: rule.forbidden ?? []
  }));
}

export function validateInputRules(rules: InputRule[], params: Record<string, unknown>): string | undefined {
  if (rules.length === 0) {
    return undefined;
  }

  const controllingFields = new Set(controllingFieldNames(rules[0]));
  for (const rule of rules.slice(1)) {
    for (const field of controllingFields) {
      if (!controllingFieldNames(rule).includes(field)) {
        controllingFields.delete(field);
      }
    }
  }
  for (const field of controllingFields) {
    if (!hasValue(params[field])) {
      return `${field} is required to choose a valid parameter shape.`;
    }
  }

  for (const rule of rules) {
    const conditions = rule.when ?? {};
    const matches = Object.entries(conditions).every(([field, condition]) => conditionMatches(params, field, condition));
    if (!matches) {
      continue;
    }

    const required = rule.required ?? [];
    const requiredAny = rule.required_any ?? [];
    const forbidden = rule.forbidden ?? [];
    const narrowedEnums = rule.enum ?? {};
    const missing = required.filter((field) => !hasValue(params[field]));
    const missingAny = requiredAny.length > 0 && requiredAny.every((field) => !hasValue(params[field]));
    const presentForbidden = forbidden.filter((field) => hasValue(params[field]));
    const invalidEnums = Object.entries(narrowedEnums).filter(([field, allowed]) => (
      hasValue(params[field]) && !allowed.some((candidate) => String(candidate) === String(params[field]))
    ));
    if (missing.length === 0 && !missingAny && presentForbidden.length === 0 && invalidEnums.length === 0) {
      continue;
    }

    const parts = [];
    if (missing.length > 0) {
      parts.push(`requires ${missing.join(", ")}`);
    }
    if (missingAny) {
      parts.push(`requires one of ${requiredAny.join(", ")}`);
    }
    if (presentForbidden.length > 0) {
      parts.push(`must not include ${presentForbidden.join(", ")}`);
    }
    for (const [field, allowed] of invalidEnums) {
      parts.push(`requires ${field} to be one of ${allowed.map(String).join(", ")}`);
    }

    const context = formatWhen(conditions);
    return `${context ? `${context} ` : ""}${parts.join(" and ")}.`;
  }

  return undefined;
}

function controllingFieldNames(rule: InputRule): string[] {
  return Object.entries(rule.when ?? {})
    .filter(([, condition]) => !isPresenceCondition(condition))
    .map(([field]) => field);
}

function conditionMatches(params: Record<string, unknown>, field: string, condition: unknown): boolean {
  if (isPresenceCondition(condition)) {
    return hasValue(params[field]) === (condition.present === true);
  }
  return params[field] === condition;
}

function isPresenceCondition(condition: unknown): condition is { present: unknown } {
  return typeof condition === "object" && condition !== null && "present" in condition;
}

// An empty array counts as absent, matching every other contract validator: a
// rule that forbids an array field should not fire on `[]`, which supplies
// nothing.
function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function formatWhen(when: Record<string, unknown>): string {
  return Object.entries(when).map(([field, condition]) => {
    if (isPresenceCondition(condition)) {
      return condition.present === true ? `${field} is present` : `${field} is absent`;
    }
    return `${field}=${String(condition)}`;
  }).join(", ");
}
