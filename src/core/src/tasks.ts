export const taskTypes = ["networking_follow_up", "application", "interview_prep", "sourcing", "resume", "administrative", "learning", "other"] as const;
export type TaskType = (typeof taskTypes)[number];
export const taskStatuses = ["open", "in_progress", "completed", "canceled"] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const taskPriorities = ["high", "medium", "low"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export interface TaskRecord {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  relatedEntity: { type: "contact" | "job" | "general"; id: string | null; label: string };
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export const taskTypeLabels: Record<TaskType, string> = { networking_follow_up: "Networking", application: "Application", interview_prep: "Interview prep", sourcing: "Sourcing", resume: "Resume", administrative: "Administrative", learning: "Learning", other: "Other" };
export const taskStatusLabels: Record<TaskStatus, string> = { open: "Open", in_progress: "In progress", completed: "Completed", canceled: "Canceled" };
export function taskIsOverdue(task: TaskRecord, today: string) { return Boolean(task.dueDate && task.dueDate < today && ["open", "in_progress"].includes(task.status)); }
export function taskIsDueToday(task: TaskRecord, today: string) { return task.dueDate === today && ["open", "in_progress"].includes(task.status); }
export function compareTasks(a: TaskRecord, b: TaskRecord, today: string) {
  const state = (task: TaskRecord) => taskIsOverdue(task, today) ? 0 : taskIsDueToday(task, today) ? 1 : task.dueDate ? 2 : 3;
  return state(a) - state(b) || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || taskPriorities.indexOf(a.priority) - taskPriorities.indexOf(b.priority) || a.title.localeCompare(b.title);
}
