import type { TaskRecord } from "../../../core/tasks";
export type TasksResult = { ok: true; data: TaskRecord[] } | { ok: false; error: unknown };
export async function loadTasks(): Promise<TasksResult> {
  try {
    const response = await fetch("/api/tasks", { cache: "no-store" });
    if (!response.ok) throw new Error(`Tasks API returned ${response.status}.`);
    return { ok: true, data: await response.json() as TaskRecord[] };
  } catch (error) { return { ok: false, error }; }
}
