import type { InputRule } from "./types.js";

export type { InputRule } from "./types.js";

export function validateInputRules(rules: InputRule[], params: Record<string, unknown>): string | undefined {
  if (rules.length === 0) {
    return undefined;
  }

  const controllingFields = new Set(rules.flatMap((rule) => Object.keys(rule.when)));
  for (const field of controllingFields) {
    if (!hasValue(params[field])) {
      return `${field} is required to choose a valid parameter shape.`;
    }
  }

  const rule = rules.find((candidate) => Object.entries(candidate.when).every(([field, value]) => params[field] === value));
  if (!rule) {
    return undefined;
  }

  const required = rule.required ?? [];
  const forbidden = rule.forbidden ?? [];
  const missing = required.filter((field) => !hasValue(params[field]));
  const presentForbidden = forbidden.filter((field) => hasValue(params[field]));
  if (missing.length === 0 && presentForbidden.length === 0) {
    return undefined;
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

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

function formatWhen(when: Record<string, unknown>): string {
  return Object.entries(when).map(([field, value]) => `${field}=${String(value)}`).join(", ");
}
