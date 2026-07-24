import { expect, test } from "bun:test";
import { compareTasks, taskIsDueToday, taskIsOverdue, type TaskRecord } from "../src/tasks";
const task = (patch: Partial<TaskRecord> = {}): TaskRecord => ({ id: "task", title: "Task", type: "other", status: "open", priority: "medium", dueDate: "2026-07-21", relatedEntity: { type: "general", id: null, label: "General" }, notes: null, createdAt: "2026-07-20", updatedAt: "2026-07-20", completedAt: null, ...patch });
test("task dates distinguish overdue from due today", () => { expect(taskIsOverdue(task({ dueDate: "2026-07-20" }), "2026-07-21")).toBe(true); expect(taskIsDueToday(task(), "2026-07-21")).toBe(true); });
test("task ordering puts overdue work first", () => { expect([task({ id: "future", dueDate: "2026-07-25" }), task({ id: "late", dueDate: "2026-07-20" })].sort((a, b) => compareTasks(a, b, "2026-07-21"))[0]?.id).toBe("late"); });
