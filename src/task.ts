import type { RunApiTaskResponse } from "./types.js";

export function taskStatus(task?: RunApiTaskResponse): string {
  const status = task?.status || task?.state || nestedString(task?.data, "status");
  return typeof status === "string" ? status.toLowerCase() : "unknown";
}

export function taskIdFromResponse(task: RunApiTaskResponse): string | undefined {
  const id = task.id || task.task_id || nestedString(task.data, "id") || nestedString(task.data, "task_id");
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function nestedString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested : undefined;
}
