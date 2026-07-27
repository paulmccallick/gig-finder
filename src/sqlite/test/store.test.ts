import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DataError, DataStore, migrateDatabase, openDatabase, RevisionConflictError } from "../src";
import type { ChangeContext,JobData,MeetingData,NetworkingContactData,PersonData,TaskData } from "../../core/src/models";
import { JobSearchApplication } from "../../core/src/application";
import type { ArtifactPort } from "../../core/src/ports";
import { AuditReader } from "../src/audit";
import { MutationError } from "../../core/src/errors";

let database: Database;
let store: DataStore;
const timestamp = "2026-07-21T12:00:00.000Z";
const context = (summary = "Test change"): ChangeContext => ({ actor: "test-suite", source: "test", summary, occurredAt: timestamp });

const job: JobData = { id:"job-1",company:"Company",title:"VP Engineering",externalJobId:"123",stage:"identified",outcome:"pending",statusSummary:"Identified",lastActivity:"2026-07-21",nextActionDescription:"Review",nextActionDue:"2026-07-22",fitRating:"good",fitSummary:"Good role shape",payCurrency:"USD",payMinimum:200000,payMaximum:250000,payPeriod:"year",payNotes:null,sourceUrl:"https://example.com/jobs/123",location:"Seattle",workArrangement:"hybrid",postedDate:"2026-07-20",businessUnitTeam:"Platform",recruiterSource:"Referral",bonus:"Annual bonus",equity:null,otherCompensation:null,tagsJson:'["platform"]',hasJobDescription:false,hasInterviewPrep:false };
const person:PersonData={id:"person-1",name:"Person One",company:"Company",title:"CTO",linkedInProfileUrl:"https://www.linkedin.com/in/person-one",connectedOn:"2020-01-01",hasLocalProfile:false};
const networking:NetworkingContactData={id:"person-1",personId:"person-1",relationshipType:"former_colleague",relationshipStrength:"strong",introducedBy:null,relationshipNotes:null,priority:"high",status:"not_contacted",lastContacted:null,lastContactMethod:null,lastContactSummary:null,nextAction:"Reach out",nextActionDue:"2026-07-22",whyInteresting:"Strong relationship",notesJson:"[]",tagsJson:"[]"};
const task: TaskData = { id:"task-1",title:"Review role",type:"application",status:"open",priority:"high",dueDate:"2026-07-22",relatedEntityType:"job",relatedEntityId:"job-1",relatedEntityLabel:"Company VP Engineering",notes:"Review the JD",completedAt:null };
const meeting: MeetingData = { id:"meeting-1",title:"Coffee",startsAt:"2026-07-22T12:00:00-07:00",endsAt:"2026-07-22T13:00:00-07:00",timezone:"America/Los_Angeles",location:"Seattle",description:"Networking",status:"confirmed",relatedEntityType:"contact",relatedEntityId:"person-1",externalCalendarId:"job-search",externalEventId:"google-1" };

beforeEach(() => { database = openDatabase(":memory:"); migrateDatabase(database); store = new DataStore(database); });
afterEach(() => database.close());

describe("migrations", () => {
  test("creates every live, history, change, event, and source table", () => {
    const names = database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String((row as {name:string}).name));
    for (const table of ["jobs","job_history","people","person_history","networking_contacts","networking_contact_history","job_people","job_people_history","tasks","task_history","meetings","meeting_history","changes","business_events","event_sources","__drizzle_migrations"]) expect(names).toContain(table);
  });
  test("can be applied repeatedly without duplicating migrations", () => { const before = (database.query("SELECT count(*) count FROM __drizzle_migrations").get() as {count:number}).count; migrateDatabase(database); expect((database.query("SELECT count(*) count FROM __drizzle_migrations").get() as {count:number}).count).toBe(before); });
  test("enables foreign key enforcement", () => { expect((database.query("PRAGMA foreign_keys").get() as {foreign_keys:number}).foreign_keys).toBe(1); });
  test("enforces binary deletion and history operation constraints", () => {
    expect(() => database.query("INSERT INTO tasks (id,title,type,status,priority,related_entity_type,related_entity_label,revision,is_deleted,created_at,updated_at) VALUES ('bad','Bad','other','open','low','general','General',1,2,?,?)").run(timestamp,timestamp)).toThrow();
    store.change(context("Create task"), (tx) => tx.tasks.create(task));
    const changeId = (database.query("SELECT id FROM changes").get() as {id:string}).id;
    expect(() => database.query("INSERT INTO task_history (change_id,operation,recorded_at,recorded_by,id,title,type,status,priority,related_entity_type,related_entity_label,revision,is_deleted,created_at,updated_at) VALUES (?,'invalid',?,?,'bad','Bad','other','open','low','general','General',1,0,?,?)").run(changeId,timestamp,"test-suite",timestamp,timestamp)).toThrow();
  });
  test("persists migrated data across a file-backed database reopen", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "job-search-data-test-"));
    const filename = path.join(directory, "test.sqlite");
    try {
      const first = openDatabase(filename); migrateDatabase(first); new DataStore(first).change(context("Persist task"), (tx) => tx.tasks.create(task)); first.close();
      const second = openDatabase(filename, { create:false }); migrateDatabase(second); expect(new DataStore(second).tasks.get(task.id)?.title).toBe(task.title); second.close();
    } finally { await rm(directory, { recursive:true, force:true }); }
  });
});

describe("typed CRUD repositories", () => {
  test("creates and reads jobs with initial metadata", () => {
    const result = store.change(context("Create job"), (tx) => tx.jobs.create(job));
    expect(result.value).toMatchObject({ id:"job-1", revision:1, isDeleted:false, createdAt:timestamp, updatedAt:timestamp });
    expect(store.jobs.get("job-1")?.company).toBe("Company");
    expect(store.jobs.list()).toHaveLength(1);
  });
  test("supports people, networking, tasks, and meetings through the same transaction library", () => {
    store.change(context("Create records"), (tx) => ({ person:tx.people.create(person),networking:tx.networking.create(networking), task:tx.tasks.create(task), meeting:tx.meetings.create(meeting) }));
    expect(store.people.get("person-1")?.title).toBe("CTO");
    expect(store.tasks.get("task-1")?.priority).toBe("high");
    expect(store.meetings.get("meeting-1")?.externalEventId).toBe("google-1");
  });
  test("rejects duplicate IDs and rolls back the failed change record", () => {
    store.change(context("Create job"), (tx) => tx.jobs.create(job));
    expect(() => store.change(context("Duplicate job"), (tx) => tx.jobs.create(job))).toThrow("already exists");
    expect((database.query("SELECT count(*) count FROM changes").get() as {count:number}).count).toBe(1);
  });
  test("read operations never create change records", () => {
    store.jobs.get("missing"); store.jobs.list();
    expect((database.query("SELECT count(*) count FROM changes").get() as {count:number}).count).toBe(0);
  });
  test("agent context tools cannot change operational or audit state", async () => {
    store.change(context("Create records"), (tx) => {
      tx.jobs.create(job);
      tx.people.create(person);
      tx.networking.create(networking);
      tx.tasks.create(task);
    });
    const artifacts = {
      personProfile: async () => "",
      jobDescription: async () => "",
      interviewPrep: async () => [],
      personProfileExists: async () => false,
      jobDescriptionExists: async () => false,
      interviewPrepExists: async () => false,
      verify: async () => ({ ok: true, errors: [], unregistered: [] }),
    } satisfies ArtifactPort;
    const app = new JobSearchApplication(store, new AuditReader(database), artifacts);
    const before = database.serialize();

    app.agentContext.listJobs({ stages: ["applied"], limit: 10 });
    await app.agentContext.getJob(job.id);
    app.agentContext.listNetworkingContacts({ statuses: ["not_contacted"] });
    await app.agentContext.getNetworkingContact(networking.id);
    app.agentContext.listTasks({ statuses: ["open"] });
    await app.agentContext.getTask(task.id);

    expect(database.serialize()).toEqual(before);
  });
});

describe("full-row history and revisions", () => {
  test("copies the complete pre-update job and increments the live revision", () => {
    store.change(context("Create job"), (tx) => tx.jobs.create(job));
    const updated = store.change({ ...context("Apply"), occurredAt:"2026-07-22T10:00:00.000Z" }, (tx) => tx.jobs.update("job-1", 1, { stage:"applied", statusSummary:"Applied" }));
    expect(updated.value).toMatchObject({ stage:"applied", statusSummary:"Applied", revision:2 });
    const history = database.query("SELECT * FROM job_history WHERE id = 'job-1'").get() as Record<string,unknown>;
    expect(history).toMatchObject({ stage:"identified", status_summary:"Identified", revision:1, operation:"update", recorded_by:"test-suite", change_id:updated.changeId });
    expect(history.company).toBe(job.company); expect(history.tags_json).toBe(job.tagsJson);
  });
  test("takes one snapshot for each update without rewriting older history", () => {
    store.change(context("Create task"), (tx) => tx.tasks.create(task));
    store.change(context("Start task"), (tx) => tx.tasks.update("task-1", 1, { status:"in_progress" }));
    store.change(context("Complete task"), (tx) => tx.tasks.update("task-1", 2, { status:"completed", completedAt:"2026-07-22" }));
    const rows = database.query("SELECT revision, status FROM task_history ORDER BY history_id").all() as {revision:number,status:string}[];
    expect(rows).toEqual([{revision:1,status:"open"},{revision:2,status:"in_progress"}]);
    expect(store.tasks.get("task-1")).toMatchObject({ revision:3, status:"completed" });
  });
  test("rejects stale revisions without creating history or change records", () => {
    store.change(context("Create job"), (tx) => tx.jobs.create(job));
    expect(() => store.change(context("Stale update"), (tx) => tx.jobs.update("job-1", 9, { title:"Wrong" }))).toThrow(RevisionConflictError);
    expect((database.query("SELECT count(*) count FROM job_history").get() as {count:number}).count).toBe(0);
    expect((database.query("SELECT count(*) count FROM changes").get() as {count:number}).count).toBe(1);
  });
  test("rejects unknown or immutable fields", () => {
    store.change(context("Create task"), (tx) => tx.tasks.create(task));
    expect(() => store.change(context("Bad patch"), (tx) => tx.tasks.update("task-1", 1, { id:"different" } as never))).toThrow("immutable");
  });
  test("updates people and meetings with complete snapshots", () => {
    store.change(context("Create records"), (tx) => { tx.people.create(person); tx.meetings.create(meeting); });
    store.change(context("Update records"), (tx) => { tx.people.update(person.id, 1, { title:"Chief Technology Officer" }); tx.meetings.update(meeting.id, 1, { location:"Bellevue" }); });
    expect(store.people.get(person.id)).toMatchObject({ title:"Chief Technology Officer", revision:2 });
    expect(store.meetings.get(meeting.id)).toMatchObject({ location:"Bellevue", revision:2 });
    expect(database.query("SELECT title FROM person_history").get()).toEqual({title:"CTO"});
    expect(database.query("SELECT location FROM meeting_history").get()).toEqual({location:"Seattle"});
  });
});

describe("binary deletion", () => {
  test("records a pre-delete snapshot and hides the deleted live record", () => {
    store.change(context("Create person"), (tx) => tx.people.create(person));
    const deleted = store.change(context("Delete person"), (tx) => tx.people.delete("person-1", 1));
    expect(deleted.value).toMatchObject({ isDeleted:true, revision:2 });
    expect(store.people.get("person-1")).toBeNull();
    expect(store.people.get("person-1", { includeDeleted:true })?.isDeleted).toBe(true);
    expect(store.people.list()).toHaveLength(0);
    expect(store.people.list({ includeDeleted:true })).toHaveLength(1);
    expect(database.query("SELECT operation, is_deleted FROM person_history").get()).toEqual({ operation:"delete", is_deleted:0 });
  });
  test("restores a deleted record with an audited new revision", () => {
    store.change(context("Create person"), (tx) => tx.people.create(person));
    store.change(context("Delete person"), (tx) => tx.people.delete("person-1", 1));
    const restored = store.change(context("Restore person"), (tx) => tx.people.restore("person-1", 2, { title:"Restored title" }));
    expect(restored.value).toMatchObject({isDeleted:false,revision:3,title:"Restored title"});
    expect(database.query("SELECT operation, is_deleted FROM person_history ORDER BY id DESC LIMIT 1").get()).toEqual({operation:"update",is_deleted:1});
  });
  test("does not allow updates or repeated deletes of deleted records", () => {
    store.change(context("Create meeting"), (tx) => tx.meetings.create(meeting));
    store.change(context("Delete meeting"), (tx) => tx.meetings.delete("meeting-1", 1));
    expect(() => store.change(context("Update deleted"), (tx) => tx.meetings.update("meeting-1", 2, { title:"Wrong" }))).toThrow(DataError);
    expect(() => store.change(context("Delete deleted"), (tx) => tx.meetings.delete("meeting-1", 2))).toThrow(DataError);
  });
  test("deletes jobs and tasks without removing their live rows", () => {
    store.change(context("Create records"), (tx) => { tx.jobs.create(job); tx.tasks.create(task); });
    store.change(context("Delete records"), (tx) => { tx.jobs.delete(job.id, 1); tx.tasks.delete(task.id, 1); });
    expect(store.jobs.get(job.id)).toBeNull(); expect(store.tasks.get(task.id)).toBeNull();
    expect(store.jobs.get(job.id, {includeDeleted:true})).toMatchObject({isDeleted:true,revision:2});
    expect(store.tasks.get(task.id, {includeDeleted:true})).toMatchObject({isDeleted:true,revision:2});
    expect(database.query("SELECT operation FROM job_history").get()).toEqual({operation:"delete"});
    expect(database.query("SELECT operation FROM task_history").get()).toEqual({operation:"delete"});
  });
});

describe("change envelopes, business events, and evidence", () => {
  test("ties multiple records and events to one change ID", () => {
    const result = store.change(context("Record application and follow-up"), (tx) => {
      tx.jobs.create(job); tx.tasks.create(task);
      return tx.recordEvent({ type:"application_submitted", entityType:"job", entityId:job.id, occurredAt:timestamp, summary:"Applied", sources:[{ sourceSystem:"gmail", externalId:"message-1", sourceTimestamp:timestamp, sourceUri:"https://mail.google.com/message-1", importedAt:timestamp, contentHash:"abc", excerpt:"Application received" }] });
    });
    expect((database.query("SELECT change_id FROM business_events").get() as {change_id:string}).change_id).toBe(result.changeId);
    expect(database.query("SELECT source_system, external_id FROM event_sources").get()).toEqual({source_system:"gmail",external_id:"message-1"});
    expect(database.query("SELECT actor, source, summary FROM changes WHERE id = ?").get(result.changeId)).toEqual({ actor:"test-suite", source:"test", summary:"Record application and follow-up" });
  });
  test("uses one shared change ID for multiple history snapshots", () => {
    store.change(context("Create records"), (tx) => { tx.jobs.create(job); tx.tasks.create(task); });
    const result = store.change(context("Advance records"), (tx) => { tx.jobs.update(job.id, 1, { stage:"applied" }); tx.tasks.update(task.id, 1, { status:"completed", completedAt:"2026-07-21" }); });
    expect((database.query("SELECT change_id FROM job_history").get() as {change_id:string}).change_id).toBe(result.changeId);
    expect((database.query("SELECT change_id FROM task_history").get() as {change_id:string}).change_id).toBe(result.changeId);
  });
  test("rolls back all records, history, events, sources, and the change on failure", () => {
    expect(() => store.change(context("Fail everything"), (tx) => { tx.jobs.create(job); tx.recordEvent({ type:"role_identified", entityType:"job", entityId:job.id, occurredAt:timestamp, summary:"Found", sources:[{sourceSystem:"scout",externalId:"role-1",importedAt:timestamp}] }); throw new Error("boom"); })).toThrow("boom");
    for (const table of ["jobs","changes","business_events","event_sources","job_history"]) expect((database.query(`SELECT count(*) count FROM ${table}`).get() as {count:number}).count).toBe(0);
  });
  test("rolls back record updates and their snapshots together", () => {
    store.change(context("Create records"), (tx) => { tx.jobs.create(job); tx.tasks.create(task); });
    expect(() => store.change(context("Failed update"), (tx) => { tx.jobs.update(job.id, 1, { stage:"applied" }); tx.tasks.update(task.id, 1, { status:"completed", completedAt:"2026-07-21" }); throw new Error("stop"); })).toThrow("stop");
    expect(store.jobs.get(job.id)).toMatchObject({stage:"identified",revision:1});
    expect(store.tasks.get(task.id)).toMatchObject({status:"open",revision:1});
    expect((database.query("SELECT count(*) count FROM job_history").get() as {count:number}).count).toBe(0);
    expect((database.query("SELECT count(*) count FROM task_history").get() as {count:number}).count).toBe(0);
    expect((database.query("SELECT count(*) count FROM changes").get() as {count:number}).count).toBe(1);
  });
  test("enforces external evidence deduplication", () => {
    store.change(context("First event"), (tx) => tx.recordEvent({ type:"message_received", entityType:"contact", entityId:"person-1", occurredAt:timestamp, summary:"Reply", sources:[{sourceSystem:"beeper",externalId:"msg-1",importedAt:timestamp}] }));
    expect(() => store.change(context("Duplicate evidence"), (tx) => tx.recordEvent({ type:"message_received", entityType:"contact", entityId:"person-1", occurredAt:timestamp, summary:"Duplicate", sources:[{sourceSystem:"beeper",externalId:"msg-1",importedAt:timestamp}] }))).toThrow();
    expect((database.query("SELECT count(*) count FROM business_events").get() as {count:number}).count).toBe(1);
    expect((database.query("SELECT count(*) count FROM changes").get() as {count:number}).count).toBe(1);
  });
  test("requires actor and summary metadata", () => { expect(() => store.change({ actor:"", source:"test", summary:"" }, () => undefined)).toThrow("required"); });
});

describe("agent mutation safety", () => {
  test("rejects a duplicate explicit change ID before applying a retry", () => {
    store.change(context("Create job"), tx => tx.jobs.create(job));
    const agentContext: ChangeContext = {
      actor: "JobSearchAgent",
      source: "agent",
      summary: "Update job",
      changeId: "agent-tool:call-1",
    };
    store.change(agentContext, tx =>
      tx.jobs.update(job.id, 1, { statusSummary: "Updated once" }));
    expect(() => store.change(agentContext, tx =>
      tx.jobs.update(job.id, 2, { statusSummary: "Updated twice" })))
      .toThrow(MutationError);
    expect(store.jobs.get(job.id)).toMatchObject({
      revision: 2,
      statusSummary: "Updated once",
    });
  });

  test("reverts an agent job update as a new audited revision", () => {
    store.change(context("Create job"), tx => tx.jobs.create(job));
    store.change({
      actor: "JobSearchAgent",
      source: "agent",
      summary: "Update job",
      changeId: "agent-tool:call-job",
    }, tx => tx.jobs.update(job.id, 1, {
      stage: "applied",
      statusSummary: "Application submitted",
    }));

    const reverted = store.revertAgentChange({
      actor: "JobSearchAgent",
      source: "agent",
      summary: "Revert job update",
      changeId: "agent-revert:call-job",
    }, "agent-tool:call-job");

    expect(reverted.value).toEqual([{ entity: "job", id: job.id }]);
    expect(store.jobs.get(job.id)).toMatchObject({
      revision: 3,
      stage: "identified",
      statusSummary: "Identified",
    });
    expect(database.query(
      "SELECT parent_change_id FROM changes WHERE id = 'agent-revert:call-job'",
    ).get()).toEqual({ parent_change_id: "agent-tool:call-job" });
    expect(database.query(
      "SELECT change_id, revision FROM job_history ORDER BY history_id",
    ).all()).toEqual([
      { change_id: "agent-tool:call-job", revision: 1 },
      { change_id: "agent-revert:call-job", revision: 2 },
    ]);
    expect(() => store.revertAgentChange({
      actor: "JobSearchAgent",
      source: "agent",
      summary: "Retry revert",
      changeId: "agent-revert:call-job",
    }, "agent-tool:call-job")).toThrow("already been applied");
  });

  test("reverts person and networking rows atomically", () => {
    store.change(context("Create contact"), tx => {
      tx.people.create(person);
      tx.networking.create(networking);
    });
    store.change({
      actor: "JobSearchAgent",
      source: "agent",
      summary: "Update contact",
      changeId: "agent-tool:call-contact",
    }, tx => {
      tx.people.update(person.id, 1, { title: "Chief Product Officer" });
      tx.networking.update(networking.id, 1, { status: "active_relationship" });
    });

    store.revertAgentChange({
      actor: "JobSearchAgent",
      source: "agent",
      summary: "Revert contact",
      changeId: "agent-revert:call-contact",
    }, "agent-tool:call-contact");

    expect(store.people.get(person.id)).toMatchObject({ title: "CTO", revision: 3 });
    expect(store.networking.get(networking.id)).toMatchObject({
      status: "not_contacted",
      revision: 3,
    });
  });

  test("rejects a revert when a later edit would be overwritten", () => {
    store.change(context("Create job"), tx => tx.jobs.create(job));
    store.change({
      actor: "JobSearchAgent",
      source: "agent",
      summary: "Update job",
      changeId: "agent-tool:call-conflict",
    }, tx => tx.jobs.update(job.id, 1, { statusSummary: "Agent update" }));
    store.change(context("Later edit"), tx =>
      tx.jobs.update(job.id, 2, { statusSummary: "Later edit" }));

    expect(() => store.revertAgentChange({
      actor: "JobSearchAgent",
      source: "agent",
      summary: "Unsafe revert",
      changeId: "agent-revert:call-conflict",
    }, "agent-tool:call-conflict")).toThrow("later revision");
    expect(store.jobs.get(job.id)).toMatchObject({
      revision: 3,
      statusSummary: "Later edit",
    });
  });
});
