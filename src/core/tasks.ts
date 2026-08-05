import { z } from "zod";
import { isCalendarDate } from "./queries";

export const taskTypes = ["networking_follow_up", "application", "interview_prep", "sourcing", "resume", "administrative", "learning", "other"] as const;
export type TaskType = (typeof taskTypes)[number];
export const taskStatuses = ["open", "in_progress", "completed", "canceled"] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const taskPriorities = ["high", "medium", "low"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

const taskDateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,"Must use YYYY-MM-DD.").refine(isCalendarDate,"Must be a valid calendar date.");
export const taskRelatedEntityInputSchema=z.object({type:z.enum(["gig","person","general"]).describe("Related entity type."),id:z.string().trim().min(1).nullable().describe("Exact Gig or Person ID, or null for general.")}).strict().superRefine((value,context)=>{if(value.type==="general"&&value.id!==null)context.addIssue({code:"custom",path:["id"],message:"A general task must use a null related-entity ID."});if(value.type!=="general"&&value.id===null)context.addIssue({code:"custom",path:["id"],message:`A ${value.type} task requires an exact related-entity ID.`})});
const taskMutableFields={title:z.string().trim().min(1).describe("Concise task title."),type:z.enum(taskTypes).describe("Task category type."),status:z.enum(taskStatuses).describe("Task status."),priority:z.enum(taskPriorities).describe("Task priority."),dueDate:taskDateSchema.nullable().describe("Due date, or null."),relatedEntity:taskRelatedEntityInputSchema.describe("Gig, Person, or general relationship."),notes:z.string().trim().nullable().describe("Notes, or null.")};
export const taskEntitySchema=z.object({id:z.string().trim().min(1),...taskMutableFields,relatedEntity:z.object({...taskRelatedEntityInputSchema.shape,label:z.string().trim().min(1)}).strict(),createdAt:taskDateSchema,updatedAt:taskDateSchema,completedAt:taskDateSchema.nullable()}).strict();
export const taskInputSchema=z.object({title:taskMutableFields.title.optional(),type:taskMutableFields.type.optional(),status:taskMutableFields.status.optional(),priority:taskMutableFields.priority.optional(),dueDate:taskMutableFields.dueDate.optional(),relatedEntity:taskMutableFields.relatedEntity.optional(),notes:taskMutableFields.notes.optional()}).strict().refine(value=>Object.keys(value).length>0,"Task input must contain at least one field.");
export type Task=z.infer<typeof taskEntitySchema>;
export type TaskRecord=Task;
export type TaskInput=z.infer<typeof taskInputSchema>;
export type TaskRelatedEntityInput=z.infer<typeof taskRelatedEntityInputSchema>;
export const taskInputFieldPaths=["title","type","status","priority","dueDate","relatedEntity","notes"] as const;
export const taskClearableInputFieldPaths=new Set<typeof taskInputFieldPaths[number]>(["dueDate","notes"]);

export const taskTypeLabels: Record<TaskType, string> = { networking_follow_up: "Networking", application: "Application", interview_prep: "Interview prep", sourcing: "Sourcing", resume: "Resume", administrative: "Administrative", learning: "Learning", other: "Other" };
export const taskStatusLabels: Record<TaskStatus, string> = { open: "Open", in_progress: "In progress", completed: "Completed", canceled: "Canceled" };
export function taskIsOverdue(task: TaskRecord, today: string) { return Boolean(task.dueDate && task.dueDate < today && ["open", "in_progress"].includes(task.status)); }
export function taskIsDueToday(task: TaskRecord, today: string) { return task.dueDate === today && ["open", "in_progress"].includes(task.status); }
export function compareTasks(a: TaskRecord, b: TaskRecord, today: string) {
  const state = (task: TaskRecord) => taskIsOverdue(task, today) ? 0 : taskIsDueToday(task, today) ? 1 : task.dueDate ? 2 : 3;
  return state(a) - state(b) || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || taskPriorities.indexOf(a.priority) - taskPriorities.indexOf(b.priority) || a.title.localeCompare(b.title);
}
