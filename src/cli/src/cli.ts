import path from "node:path";
import { readFile } from "node:fs/promises";
import { completeTask, createDocument, createEvent, createGig, createGigPerson, createMeeting, createPerson, createTaskFromInput, getDocument, getGig, getMeeting, getPerson, getTask, listDocuments, listDocumentVersions, listEvents, listGigs, listMeetings, listPeople, listTasks, pacificDate, syncArtifacts, touchGig, touchPerson, updateDocument, updateGig, updatePerson, updateTask, verifyArtifacts, type CliRuntime, type TaskRecord } from "./db-store";
import type { BusinessEventInput,GigPersonData } from "../../core/src/models";
import type { Meeting } from "../../core/src/meetings";
import type { PersonStatus, Person, PersonCreateInput } from "../../core/src";
import type { GigSummary, Outcome, PipelineStage } from "../../core/src/gigs";
import {
  candidateProfileId,
  documentMediaTypes,
  managedDocumentTypes,
} from "../../core/src/documents";
import {
  gigUpdateSchema,
  personUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from "../../core/src/update-contracts";

export const cliUsage = `gig-finder — GigFinder CLI

Usage:
  gig-finder gigs get <id>
  gig-finder gigs list
  gig-finder people get <id>
  gig-finder people list
  gig-finder gigs add <id> --patch '<json>' [--dry-run]
  gig-finder gigs update <id> --patch-file <path> [--dry-run]
  gig-finder gigs touch <id> --date YYYY-MM-DD --stage <stage> --summary <text> [--outcome <outcome>] [--next-action <text>] [--due YYYY-MM-DD|none]
  gig-finder people add <id> --patch-file <path> [--dry-run]
  gig-finder people update <id> --patch-file <path> [--date YYYY-MM-DD] [--dry-run]
  gig-finder people touch <id> --date YYYY-MM-DD --status <status> --method <method> --summary <text> [--next-action <text>] [--due YYYY-MM-DD|none]
  gig-finder tasks add <id> --title <text> --type <type> --due <YYYY-MM-DD|none> --related-type <person|gig|general> [--related-id <id>] [--priority <priority>] [--notes <text>] [--date YYYY-MM-DD] [--dry-run]
  gig-finder tasks update <id> --patch-file <path> [--date YYYY-MM-DD] [--dry-run]
  gig-finder tasks complete <id> --date YYYY-MM-DD [--dry-run]
  gig-finder meetings get <id>
  gig-finder meetings list
  gig-finder meetings add <id> --patch-file <path> [--dry-run]
  gig-finder events list [--entity-type <type>] [--entity-id <id>]
  gig-finder events add <id> --patch-file <path> [--dry-run]
  gig-finder artifacts verify
  gig-finder artifacts sync
  gig-finder documents list (--gig <gig-id> | --person <person-id> | --profile)
  gig-finder documents get <document-id>
  gig-finder documents create [--gigs <id,...>] [--people <id,...>] [--profile] --type <type> --media-type <type> --content-file <path> [--title <text>] [--description <text>] [--source-description <text>]
  gig-finder documents update <document-id> --expected-version <number> --change-summary <text> --content-file <path>
  gig-finder documents versions <document-id>

Patch files are recommended for long or sensitive text. Arrays are replaced;
objects are deep-merged; null explicitly clears a value. All writes are atomic.`;
const usage = cliUsage;

type Flags = Record<string, string | boolean>;
const parseFlags = (args: string[]): Flags => {
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "dry-run" || key === "profile") { flags[key] = true; continue; }
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
const commaList = (flags: Flags, key: string): string[] => (optional(flags, key) ?? "").split(",").map(value => value.trim()).filter(Boolean);
const nullable = (value: string | undefined): string | null | undefined => value === "none" ? null : value;
async function patchFrom(flags: Flags): Promise<Record<string, unknown>> {
  const inline = optional(flags, "patch");
  const file = optional(flags, "patch-file");
  if (Boolean(inline) === Boolean(file)) throw new Error("Provide exactly one of --patch or --patch-file.");
  const value = JSON.parse(inline ?? await readFile(path.resolve(file!), "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Patch must be a JSON object.");
  return value;
}

const positiveInteger = (flags: Flags, key: string): number => {
  const raw = required(flags, key);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  return value;
};

const acceptedValue = <T extends string>(
  flags: Flags,
  key: string,
  values: readonly T[],
): T => {
  const value = required(flags, key);
  const accepted = values.find(candidate => candidate === value);
  if (!accepted) {
    throw new Error(`--${key} must be one of: ${values.join(", ")}.`);
  }
  return accepted;
};

async function handleDocuments(args: string[], runtime: CliRuntime): Promise<boolean> {
  if (args[0] !== "documents") return false;
  const command = args[1];
  const paths = runtime;

  if (command === "list") {
    const flags = parseFlags(args.slice(2));
    const gigId = optional(flags, "gig");
    const personId = optional(flags, "person");
    const profile = flags.profile === true;
    if ([gigId, personId, profile].filter(Boolean).length !== 1) {
      throw new Error("Provide exactly one of --gig, --person, or --profile.");
    }
    const entityType = gigId ? "gig" as const : personId ? "person" as const : "profile" as const;
    const entityId = gigId ?? personId ?? candidateProfileId;
    console.log(JSON.stringify({
      ok: true,
      entity: "document",
      command,
      link: { entityType, entityId },
      records: listDocuments(paths, entityType, entityId),
    }, null, 2));
    return true;
  }

  if (command === "get" || command === "versions") {
    const reference = args[2];
    if (!reference || args.length !== 3) throw new Error(usage);
    const document = getDocument(paths, reference);
    if (!document) throw new Error(`Document not found: ${reference}`);
    console.log(JSON.stringify({
      ok: true,
      entity: "document",
      command,
      reference,
      [command === "get" ? "record" : "records"]:
        command === "get" ? document : listDocumentVersions(paths, reference),
    }, null, 2));
    return true;
  }

  if (command === "create") {
    const flags = parseFlags(args.slice(2));
    const content = await readFile(
      path.resolve(required(flags, "content-file")),
      "utf8",
    );
    const result = createDocument(paths, {
      links: [
        ...(optional(flags, "gig") ? [{ entityType: "gig" as const, entityId: optional(flags, "gig")! }] : []),
        ...(optional(flags, "person") ? [{ entityType: "person" as const, entityId: optional(flags, "person")! }] : []),
        ...(flags.profile === true ? [{ entityType: "profile" as const, entityId: candidateProfileId }] : []),
        ...commaList(flags, "gigs").map(entityId => ({ entityType: "gig" as const, entityId })),
        ...commaList(flags, "people").map(entityId => ({ entityType: "person" as const, entityId })),
      ],
      documentType: acceptedValue(flags, "type", managedDocumentTypes),
      title: optional(flags, "title") ?? null,
      description: optional(flags, "description") ?? null,
      mediaType: acceptedValue(flags, "media-type", documentMediaTypes),
      sourceDescription: optional(flags, "source-description") ?? null,
      content,
    });
    console.log(JSON.stringify({
      ok: true,
      entity: "document",
      command,
      record: result.document,
      changeId: result.changeId,
      changed: result.changed,
    }, null, 2));
    return true;
  }

  if (command === "update") {
    const reference = args[2];
    if (!reference) throw new Error(usage);
    const flags = parseFlags(args.slice(3));
    const content = await readFile(
      path.resolve(required(flags, "content-file")),
      "utf8",
    );
    const result = updateDocument(paths, {
      documentId: reference,
      expectedVersion: positiveInteger(flags, "expected-version"),
      changeSummary: required(flags, "change-summary"),
      content,
    });
    console.log(JSON.stringify({
      ok: true,
      entity: "document",
      command,
      reference,
      record: result.document,
      changeId: result.changeId,
      changed: result.changed,
    }, null, 2));
    return true;
  }

  throw new Error(usage);
}

export async function runCli(args: string[], runtime: CliRuntime) {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) { console.log(usage); return; }
  if (await handleDocuments(args, runtime)) return;
  if(args[0]==="artifacts"&&args[1]==="verify"){const result=await verifyArtifacts(runtime);console.log(JSON.stringify({ok:result.ok,result},null,2));if(!result.ok)process.exitCode=1;return}
  if(args[0]==="artifacts"&&args[1]==="sync"){const result=await syncArtifacts(runtime);console.log(JSON.stringify({ok:true,result},null,2));return}
  const aliases:Record<string,string>={gigs:"gig",tasks:"task",people:"person","gig-people":"gig-person",meetings:"meeting",events:"event"};
  const [rawEntity, command, id, ...rest] = args;const entity=aliases[rawEntity??""]??rawEntity;
  if (!entity || !["gig", "person", "gig-person", "task", "meeting", "event"].includes(entity) || !["get", "list", "update", "touch", "add", "complete"].includes(command ?? "")) throw new Error(usage);
  if (entity === "event" && command === "list") {
    const flags = parseFlags(args.slice(2));
    console.log(JSON.stringify({ok:true,entity,command,records:listEvents(runtime,optional(flags,"entity-type"),optional(flags,"entity-id"))},null,2));
    return;
  }
  if (command === "get" || command === "list") {
    if ((command === "get" && !id) || (command === "list" && id)) throw new Error(usage);
    const paths = runtime;
    const result = command === "list"
      ? entity === "gig" ? listGigs(paths) : entity === "person" ? listPeople(paths) : entity === "meeting" ? listMeetings(paths) : listTasks(paths)
      : entity === "gig" ? getGig(paths, id!) : entity === "person" ? getPerson(paths,id!) : entity === "meeting" ? getMeeting(paths,id!) : getTask(paths, id!);
    if (command === "get" && result === null) throw new Error(`${entity[0]!.toUpperCase()}${entity.slice(1)} not found: ${id}`);
    console.log(JSON.stringify({ ok: true, entity, command, ...(id ? { id } : {}), [command === "list" ? "records" : "record"]: result }, null, 2));
    return;
  }
  if (!id) throw new Error(usage);
  const flags = parseFlags(rest);
  const paths = runtime;
  const dryRun = flags["dry-run"] === true;
  let result: GigSummary | Person | TaskRecord | GigPersonData | Meeting | BusinessEventInput;

  if(entity==="event"&&command==="add"){const record=await patchFrom(flags) as unknown as BusinessEventInput;if(record.id!==id)throw new Error("Event id must match the command id.");result=createEvent(paths,record,{dryRun});
  }else if(entity==="meeting"&&command==="add"){const record=await patchFrom(flags) as unknown as Meeting;if(record.id!==id)throw new Error("Meeting id must match the command id.");result=createMeeting(paths,record,{dryRun});
  }else if(entity==="gig-person"&&command==="add"){const record=await patchFrom(flags) as unknown as GigPersonData;if(record.id!==id)throw new Error("Gig-person id must match the command id.");result=createGigPerson(paths,record,{dryRun});
  }else if(entity==="person"&&command==="add"){const record=await patchFrom(flags) as unknown as PersonCreateInput;if(record.id!==id)throw new Error("Person id must match the command id.");result=createPerson(paths,record,{dryRun});
  }else if(entity==="person"&&command==="update"){result=updatePerson(paths,id,personUpdateSchema.parse(await patchFrom(flags)),{dryRun,date:optional(flags,"date")});
  }else if (entity === "gig" && command === "add") {
    const record = await patchFrom(flags) as unknown as GigSummary;
    if (record.id !== id) throw new Error("Gig id must match the command id.");
    result = await createGig(paths, record, { dryRun });
  } else if (entity === "task" && command === "add") {
    const date = optional(flags, "date") ?? pacificDate();
    const input = taskCreateSchema.parse({
      title: required(flags, "title"),
      type: required(flags, "type"),
      priority: optional(flags, "priority") ?? null,
      dueDate: nullable(required(flags, "due")) ?? null,
      relatedEntity: {
        type: required(flags, "related-type"),
        id: optional(flags, "related-id") ?? null,
      },
      notes: optional(flags, "notes") ?? null,
    });
    result = await createTaskFromInput(paths, {
      id,
      ...input,
    }, { dryRun, date });
  } else if (entity === "task" && command === "update") {
    result = await updateTask(paths, id, taskUpdateSchema.parse(await patchFrom(flags)), { dryRun, date: optional(flags, "date") });
  } else if (entity === "task" && command === "complete") {
    const date = required(flags, "date");
    result = await completeTask(paths, id, date, { dryRun, date });
  } else if (entity === "gig" && command === "update") {
    result = await updateGig(paths, id, gigUpdateSchema.parse(await patchFrom(flags)), { dryRun });
  } else if (entity === "gig") {
    const outcome = optional(flags, "outcome");
    const action = optional(flags, "next-action");
    const due = nullable(optional(flags, "due"));
    const date=required(flags,"date"),stage=required(flags,"stage") as PipelineStage;
    result = await touchGig(paths,id,{date,stage,summary:required(flags,"summary"),...(outcome!==undefined?{outcome:outcome as Outcome}:{}),...(action!==undefined?{nextAction:action}:{}),...(due!==undefined?{due}: {})},{dryRun,date});
  } else if (entity === "person") {
    const action = optional(flags, "next-action");
    const due = nullable(optional(flags, "due"));
    const date=required(flags,"date");
    result = await touchPerson(paths,id,{date,status:required(flags,"status") as PersonStatus,method:required(flags,"method"),summary:required(flags,"summary"),nextAction:action??null,due:due??null},{dryRun,date});
  } else throw new Error(usage);
  console.log(JSON.stringify({ ok: true, dryRun, entity, command, id, record: result }, null, 2));
}
