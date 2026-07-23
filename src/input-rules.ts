import { findAction } from "./contract.js";
import type { Contract, InputRule, ModelInfo } from "./types.js";

export type { InputRule } from "./types.js";

export function inputRulesForModel(
  info: Pick<ModelInfo, "service" | "action">,
  contract: Contract
): InputRule[] {
  return (findAction(info.service, info.action, contract)?.rules ?? []).map((rule) => ({
    ...rule,
    required: rule.required ?? [],
    forbidden: rule.forbidden ?? []
  }));
}

export function validateInputRules(rules: InputRule[], params: Record<string, unknown>): string | undefined {
  if (rules.length === 0) {
    return undefined;
  }

  const controllingFields = new Set(Object.keys(rules[0].when));
  for (const rule of rules.slice(1)) {
    for (const field of controllingFields) {
      if (!(field in rule.when)) {
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
    const matches = Object.entries(rule.when).every(([field, value]) => params[field] === value);
    if (!matches) {
      continue;
    }

    const required = rule.required ?? [];
    const forbidden = rule.forbidden ?? [];
    const missing = required.filter((field) => !hasValue(params[field]));
    const presentForbidden = forbidden.filter((field) => hasValue(params[field]));
    if (missing.length === 0 && presentForbidden.length === 0) {
      continue;
    }

    const parts = [];
    if (missing.length > 0) {
      parts.push(`requires ${missing.join(", ")}`);
    }
    if (presentForbidden.length > 0) {
      parts.push(`must not include ${presentForbidden.join(", ")}`);
    }

    return `${formatWhen(rule.when)} ${parts.join(" and ")}.`;
  }

  return undefined;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

function formatWhen(when: Record<string, unknown>): string {
  return Object.entries(when).map(([field, value]) => `${field}=${String(value)}`).join(", ");
}
