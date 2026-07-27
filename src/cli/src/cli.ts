import path from "node:path";
import { readFile } from "node:fs/promises";
import { completeTask, createContact, createEvent, createJob, createJobPerson, createMeeting, createPerson, createTaskFromInput, getContact, getJob, getMeeting, getPerson, getTask, listContacts, listEvents, listJobs, listMeetings, listPeople, listTasks, pacificDate, syncArtifacts, touchContact, touchJob, trackerPaths, updateContact, updateJob, updatePerson, updateTask, verifyArtifacts, type TaskPriority, type TaskRecord, type TaskType } from "./db-store";
import type { BusinessEventInput,JobPersonData,MeetingData,PersonData } from "../../core/src/models";
import type { ContactStatus, NetworkContact } from "../../core/src/network";
import type { JobRole, Outcome, PipelineStage } from "../../core/src/jobs";
import {
  jobUpdateSchema,
  networkingContactUpdateSchema,
} from "../../core/src/update-contracts";

const usage = `job-search — job-search application CLI

Usage:
  job-search jobs get <id>
  job-search jobs list
  job-search people get <id>
  job-search people list
  job-search networking get <id>
  job-search networking list
  job-search jobs add <id> --patch '<json>' [--dry-run]
  job-search jobs update <id> --patch-file <path> [--dry-run]
  job-search jobs touch <id> --date YYYY-MM-DD --stage <stage> --summary <text> [--outcome <outcome>] [--next-action <text>] [--due YYYY-MM-DD|none]
  job-search networking add <id> --patch-file <path> [--dry-run]
  job-search networking update <id> --patch-file <path> [--date YYYY-MM-DD] [--dry-run]
  job-search networking touch <id> --date YYYY-MM-DD --status <status> --method <method> --summary <text> [--next-action <text>] [--due YYYY-MM-DD|none]
  job-search tasks add <id> --title <text> --type <type> --due <YYYY-MM-DD|none> --related-type <contact|job|general> --related-label <text> [--related-id <id>] [--priority <priority>] [--notes <text>] [--date YYYY-MM-DD] [--dry-run]
  job-search tasks update <id> --patch-file <path> [--date YYYY-MM-DD] [--dry-run]
  job-search tasks complete <id> --date YYYY-MM-DD [--dry-run]
  job-search meetings get <id>
  job-search meetings list
  job-search meetings add <id> --patch-file <path> [--dry-run]
  job-search events list [--entity-type <type>] [--entity-id <id>]
  job-search events add <id> --patch-file <path> [--dry-run]
  job-search artifacts verify

Patch files are recommended for long or sensitive text. Arrays are replaced;
objects are deep-merged; null explicitly clears a value. All writes are atomic.`;

type Flags = Record<string, string | boolean>;
const parseFlags = (args: string[]): Flags => {
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "dry-run") { flags[key] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    flags[key] = value;
  }
  return flags;
};
const required = (flags: Flags, key: string): string => {
  const value = flags[key];
  if (typeof value !== "string") throw new Error(`--${key} is required.`);
  return value;
};
const optional = (flags: Flags, key: string): string | undefined => typeof flags[key] === "string" ? flags[key] : undefined;
const nullable = (value: string | undefined): string | null | undefined => value === "none" ? null : value;
const repoRoot = path.resolve(import.meta.dir, "../../..");

async function patchFrom(flags: Flags): Promise<Record<string, unknown>> {
  const inline = optional(flags, "patch");
  const file = optional(flags, "patch-file");
  if (Boolean(inline) === Boolean(file)) throw new Error("Provide exactly one of --patch or --patch-file.");
  const value = JSON.parse(inline ?? await readFile(path.resolve(file!), "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Patch must be a JSON object.");
  return value;
}

async function main(args: string[]) {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) { console.log(usage); return; }
  if(args[0]==="artifacts"&&args[1]==="verify"){const result=await verifyArtifacts(trackerPaths(repoRoot));console.log(JSON.stringify({ok:result.ok,result},null,2));if(!result.ok)process.exitCode=1;return}
  if(args[0]==="artifacts"&&args[1]==="sync"){const result=await syncArtifacts(trackerPaths(repoRoot));console.log(JSON.stringify({ok:true,result},null,2));return}
  const aliases:Record<string,string>={jobs:"job",networking:"contact",contacts:"contact",tasks:"task",people:"person","job-people":"job-person",meetings:"meeting",events:"event"};
  const [rawEntity, command, id, ...rest] = args;const entity=aliases[rawEntity??""]??rawEntity;
  if (!["job", "contact", "person", "job-person", "task", "meeting", "event"].includes(entity ?? "") || !["get", "list", "update", "touch", "add", "complete"].includes(command ?? "")) throw new Error(usage);
  if (entity === "event" && command === "list") {
    const flags = parseFlags(args.slice(2));
    console.log(JSON.stringify({ok:true,entity,command,records:listEvents(trackerPaths(repoRoot),optional(flags,"entity-type"),optional(flags,"entity-id"))},null,2));
    return;
  }
  if (command === "get" || command === "list") {
    if ((command === "get" && !id) || (command === "list" && id)) throw new Error(usage);
    const paths = trackerPaths(repoRoot);
    const result = command === "list"
      ? entity === "job" ? listJobs(paths) : entity === "contact" ? listContacts(paths) : entity === "person" ? listPeople(paths) : entity === "meeting" ? listMeetings(paths) : listTasks(paths)
      : entity === "job" ? getJob(paths, id!) : entity === "contact" ? getContact(paths, id!) : entity === "person" ? getPerson(paths,id!) : entity === "meeting" ? getMeeting(paths,id!) : getTask(paths, id!);
    if (command === "get" && result === null) throw new Error(`${entity[0]!.toUpperCase()}${entity.slice(1)} not found: ${id}`);
    console.log(JSON.stringify({ ok: true, entity, command, ...(id ? { id } : {}), [command === "list" ? "records" : "record"]: result }, null, 2));
    return;
  }
  if (!id) throw new Error(usage);
  const flags = parseFlags(rest);
  const paths = trackerPaths(repoRoot);
  const dryRun = flags["dry-run"] === true;
  let result: JobRole | NetworkContact | TaskRecord | PersonData | JobPersonData | MeetingData | BusinessEventInput;

  if(entity==="event"&&command==="add"){const record=await patchFrom(flags) as unknown as BusinessEventInput;if(record.id!==id)throw new Error("Event id must match the command id.");result=createEvent(paths,record,{dryRun});
  }else if(entity==="meeting"&&command==="add"){const record=await patchFrom(flags) as unknown as MeetingData;if(record.id!==id)throw new Error("Meeting id must match the command id.");result=createMeeting(paths,record,{dryRun});
  }else if(entity==="job-person"&&command==="add"){const record=await patchFrom(flags) as unknown as JobPersonData;if(record.id!==id)throw new Error("Job-person id must match the command id.");result=createJobPerson(paths,record,{dryRun});
  }else if(entity==="person"&&command==="add"){const record=await patchFrom(flags) as unknown as PersonData;if(record.id!==id)throw new Error("Person id must match the command id.");result=createPerson(paths,record,{dryRun});
  }else if(entity==="person"&&command==="update"){result=updatePerson(paths,id,await patchFrom(flags) as Partial<PersonData>,{dryRun});
  }else if (entity === "job" && command === "add") {
    const record = await patchFrom(flags) as unknown as JobRole;
    if (record.id !== id) throw new Error("Job id must match the command id.");
    result = await createJob(paths, record, { dryRun });
  } else if (entity === "task" && command === "add") {
    const date = optional(flags, "date") ?? pacificDate();
    const relatedType = required(flags, "related-type") as TaskRecord["relatedEntity"]["type"];
    result = await createTaskFromInput(paths, {
      id,
      title: required(flags, "title"),
      type: required(flags, "type") as TaskType,
      priority: (optional(flags, "priority") ?? "medium") as TaskPriority,
      dueDate: nullable(required(flags, "due")) ?? null,
      relatedEntity: { type: relatedType, id: relatedType === "general" ? null : optional(flags, "related-id") ?? null, label: required(flags, "related-label") },
      notes: optional(flags, "notes") ?? null,
      date,
    }, { dryRun });
  } else if (entity === "task" && command === "update") {
    result = await updateTask(paths, id, await patchFrom(flags) as Partial<TaskRecord>, { dryRun, date: optional(flags, "date") });
  } else if (entity === "task" && command === "complete") {
    const date = required(flags, "date");
    result = await completeTask(paths, id, date, { dryRun, date });
  } else if (entity === "contact" && command === "add") {
    const record = await patchFrom(flags) as unknown as NetworkContact;
    if (record.id !== id) throw new Error("Contact id must match the command id.");
    result = await createContact(paths, record, { dryRun });
  } else if (entity === "job" && command === "update") {
    result = await updateJob(paths, id, jobUpdateSchema.parse(await patchFrom(flags)), { dryRun });
  } else if (entity === "contact" && command === "update") {
    result = await updateContact(paths, id, networkingContactUpdateSchema.parse(await patchFrom(flags)), { dryRun, date: optional(flags, "date") });
  } else if (entity === "job") {
    const outcome = optional(flags, "outcome");
    const action = optional(flags, "next-action");
    const due = nullable(optional(flags, "due"));
    const date=required(flags,"date"),stage=required(flags,"stage") as PipelineStage;
    result = await touchJob(paths,id,{date,stage,summary:required(flags,"summary"),...(outcome!==undefined?{outcome:outcome as Outcome}:{}),...(action!==undefined?{nextAction:action}:{}),...(due!==undefined?{due}: {})},{dryRun,date});
  } else if (entity === "contact") {
    const action = optional(flags, "next-action");
    const due = nullable(optional(flags, "due"));
    const date=required(flags,"date");
    result = await touchContact(paths,id,{date,status:required(flags,"status") as ContactStatus,method:required(flags,"method"),summary:required(flags,"summary"),nextAction:action??null,due:due??null},{dryRun,date});
  } else throw new Error(usage);
  console.log(JSON.stringify({ ok: true, dryRun, entity, command, id, record: result }, null, 2));
}

main(process.argv.slice(2)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
