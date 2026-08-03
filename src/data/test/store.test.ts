import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DataError, DataStore, loadLegacyMeetingParticipants, migrateDatabase, openDatabase, RevisionConflictError, validateDatabase } from "../src";
import type { ChangeContext,GigData,MeetingData,MeetingParticipantData,PersonData,TaskData } from "../../core/src/models";
import { GigFinderApplication } from "../../core/src/application";
import type { ArtifactPort } from "../../core/src/ports";
import { AuditReader } from "../src/audit";
import { MutationError } from "../../core/src/errors";

let database: Database;
let store: DataStore;
const timestamp = "2026-07-21T12:00:00.000Z";
const context = (summary = "Test change"): ChangeContext => ({ actor: "test-suite", source: "test", summary, occurredAt: timestamp });

const gig: GigData = { id:"gig-1",company:"Company",title:"VP Engineering",externalJobId:"123",stage:"identified",outcome:"pending",statusSummary:"Identified",lastActivity:"2026-07-21",nextActionDescription:"Review",nextActionDue:"2026-07-22",fitRating:"good",fitSummary:"Good role shape",payCurrency:"USD",payMinimum:200000,payMaximum:250000,payPeriod:"year",payNotes:null,sourceUrl:"https://example.com/gigs/123",location:"Seattle",workArrangement:"hybrid",postedDate:"2026-07-20",businessUnitTeam:"Platform",recruiterSource:"Referral",bonus:"Annual bonus",equity:null,otherCompensation:null,tagsJson:'["platform"]',hasJobDescription:false,hasInterviewPrep:false };
const person:PersonData={id:"person-1",name:"Person One",company:"Company",title:"CTO",linkedInProfileUrl:"https://www.linkedin.com/in/person-one",connectedOn:"2020-01-01",relationshipType:"former_colleague",relationshipStrength:"strong",introducedBy:null,relationshipNotes:null,priority:"high",status:"not_contacted",lastContacted:null,lastContactMethod:null,lastContactSummary:null,nextAction:"Reach out",nextActionDue:"2026-07-22",whyInteresting:"Strong relationship",notesJson:"[]",tagsJson:"[]"};
const task: TaskData = { id:"task-1",title:"Review role",type:"application",status:"open",priority:"high",dueDate:"2026-07-22",relatedEntityType:"gig",relatedEntityId:"gig-1",relatedEntityLabel:"Company VP Engineering",notes:"Review the JD",completedAt:null };
const meeting: MeetingData = { id:"meeting-1",title:"Coffee",startsAt:"2026-07-22T12:00:00-07:00",endsAt:"2026-07-22T13:00:00-07:00",timezone:"America/Los_Angeles",location:"Seattle",description:"Networking",status:"confirmed",gigId:null,externalCalendarId:"gig-finder",externalEventId:"google-1" };
const meetingParticipant: MeetingParticipantData = { id:"meeting-1::person-1",meetingId:"meeting-1",personId:"person-1" };

beforeEach(() => { database = openDatabase(":memory:"); migrateDatabase(database); store = new DataStore(database); });
afterEach(() => database.close());

describe("migrations", () => {
  test("loads typed private meeting participant mappings", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "meeting-migration-test-"));
    const filename = path.join(directory, "participants.json");
    try {
      await Bun.write(filename, JSON.stringify({
        version: 1,
        meetings: [{ meetingId: "meeting-1", personIds: ["person-1", "person-2"] }],
      }));
      expect(loadLegacyMeetingParticipants(filename)).toEqual([
        { meetingId: "meeting-1", personId: "person-1" },
        { meetingId: "meeting-1", personId: "person-2" },
      ]);
      await Bun.write(filename, JSON.stringify({
        version: 1,
        meetings: [{ meetingId: "meeting-1", personIds: ["person-1", "person-1"] }],
      }));
      expect(() => loadLegacyMeetingParticipants(filename)).toThrow("duplicate mapping");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test("creates every live, history, change, event, and source table", () => {
    const names = database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String((row as {name:string}).name));
    for (const table of ["gigs","gig_history","people","person_history","gig_people","gig_people_history","tasks","task_history","meetings","meeting_history","meeting_participants","meeting_participant_history","changes","application_settings","business_events","event_sources","managed_documents","managed_document_versions","__drizzle_migrations"]) expect(names).toContain(table);
    expect(names).not.toContain("networking_contacts");
    expect(names).not.toContain("networking_contact_history");
  });
  test("can be applied repeatedly without duplicating migrations", () => { const before = (database.query("SELECT count(*) count FROM __drizzle_migrations").get() as {count:number}).count; migrateDatabase(database); expect((database.query("SELECT count(*) count FROM __drizzle_migrations").get() as {count:number}).count).toBe(before); });
  test("migrates legacy meeting gigs and every staged participant", async () => {
    const legacy = openDatabase(":memory:");
    legacy.exec("PRAGMA foreign_keys = OFF");
    try {
      for (let index = 0; index <= 9; index += 1) {
        const filename = `${String(index).padStart(4, "0")}_`;
        const entry = [...new Bun.Glob(`${filename}*.sql`).scanSync(path.resolve(import.meta.dir, "../drizzle"))][0];
        if (!entry) throw new Error(`Missing migration ${filename}`);
        legacy.exec(await Bun.file(path.resolve(import.meta.dir, "../drizzle", entry)).text());
      }
      legacy.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
      const migrationNine = await Bun.file(path.resolve(import.meta.dir, "../drizzle/0009_orange_luke_cage.sql")).text();
      legacy.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(
        new Bun.CryptoHasher("sha256").update(migrationNine).digest("hex"),
        1785433687058,
      );
      legacy.query("INSERT INTO jobs (id,company,title,stage,outcome,status_summary,last_activity,fit_rating,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES ('gig-legacy','Example','Director','applied','pending','Active','2026-07-01','good','[]',0,0,2,0,?,?)").run(timestamp,timestamp);
      legacy.query("INSERT INTO people (id,name,revision,is_deleted,created_at,updated_at) VALUES ('person-a','Alex Example',1,0,?,?),('person-b','Blair Example',1,0,?,?)").run(timestamp,timestamp,timestamp,timestamp);
      legacy.query("INSERT INTO networking_contacts (id,person_id,relationship_type,relationship_strength,priority,status,notes_json,tags_json,revision,is_deleted,created_at,updated_at) VALUES ('contact-a','person-a','professional_contact','warm','medium','not_contacted','[]','[]',1,0,?,?)").run(timestamp,timestamp);
      legacy.query("INSERT INTO meetings (id,title,starts_at,ends_at,timezone,status,related_entity_type,related_entity_id,revision,is_deleted,created_at,updated_at) VALUES ('meeting-legacy','Panel','2026-07-02T10:00:00-07:00','2026-07-02T11:00:00-07:00','America/Los_Angeles','completed','job','gig-legacy',4,0,?,?)").run(timestamp,timestamp);
      legacy.query("INSERT INTO changes (id,occurred_at,actor,source,summary,status) VALUES ('change-legacy',?,'test-suite','test','Legacy meeting update','committed'),('change-legacy-2',?,'test-suite','test','Legacy contact attendee','committed'),('change-legacy-3',?,'test-suite','test','Legacy person attendee','committed')").run(timestamp,timestamp,timestamp);
      legacy.query("INSERT INTO changes (id,occurred_at,actor,source,summary,status) VALUES ('change-history',?,'test-suite','test','Legacy history','committed')").run(timestamp);
      legacy.query("INSERT INTO job_history (change_id,operation,recorded_at,recorded_by,id,company,title,stage,outcome,status_summary,last_activity,fit_rating,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES ('change-history','update',?,'test-suite','gig-legacy','Example','Director','identified','pending','Found','2026-06-30','good','[]',0,0,1,0,?,?)").run(timestamp,timestamp,timestamp);
      legacy.query("INSERT INTO job_people (id,job_id,person_id,relationship,revision,is_deleted,created_at,updated_at) VALUES ('relationship-legacy','gig-legacy','person-a','recruiter',2,0,?,?)").run(timestamp,timestamp);
      legacy.query("INSERT INTO job_people_history (change_id,operation,recorded_at,recorded_by,id,job_id,person_id,relationship,revision,is_deleted,created_at,updated_at) VALUES ('change-history','update',?,'test-suite','relationship-legacy','gig-legacy','person-a','employee',1,0,?,?)").run(timestamp,timestamp,timestamp);
      legacy.query("INSERT INTO tasks (id,title,type,status,priority,related_entity_type,related_entity_id,related_entity_label,revision,is_deleted,created_at,updated_at) VALUES ('task-legacy','Follow up','application','open','high','job','gig-legacy','Example Director',2,0,?,?)").run(timestamp,timestamp);
      legacy.query("INSERT INTO task_history (change_id,operation,recorded_at,recorded_by,id,title,type,status,priority,related_entity_type,related_entity_id,related_entity_label,revision,is_deleted,created_at,updated_at) VALUES ('change-history','update',?,'test-suite','task-legacy','Review','application','open','high','job','gig-legacy','Example Director',1,0,?,?)").run(timestamp,timestamp,timestamp);
      legacy.query("INSERT INTO business_events (id,type,entity_type,entity_id,occurred_at,summary) VALUES ('event-legacy','application_update','job','gig-legacy',?,'Applied')").run(timestamp);
      legacy.query("INSERT INTO managed_documents (id,document_type,title,media_type,current_version,created_at,updated_at) VALUES ('doc_00000000-0000-4000-8000-000000000001','job_description','Job description','text/markdown',1,?,?)").run(timestamp,timestamp);
      legacy.query("INSERT INTO managed_document_versions (document_id,version,content,content_hash,change_id,change_summary,created_at,created_by) VALUES ('doc_00000000-0000-4000-8000-000000000001',1,'Original content','hash','change-history','Import',?,'test-suite')").run(timestamp);
      legacy.query("INSERT INTO managed_document_links (document_id,job_id) VALUES ('doc_00000000-0000-4000-8000-000000000001','gig-legacy')").run();
      legacy.query("INSERT INTO meeting_history (change_id,operation,recorded_at,recorded_by,id,title,starts_at,ends_at,timezone,status,related_entity_type,related_entity_id,revision,is_deleted,created_at,updated_at) VALUES ('change-legacy','update',?,'test-suite','meeting-legacy','Panel','2026-07-02T10:00:00-07:00','2026-07-02T11:00:00-07:00','America/Los_Angeles','completed','job','gig-legacy',1,0,?,?)").run(timestamp,timestamp,timestamp);
      legacy.query("INSERT INTO meeting_history (change_id,operation,recorded_at,recorded_by,id,title,starts_at,ends_at,timezone,status,related_entity_type,related_entity_id,revision,is_deleted,created_at,updated_at) VALUES ('change-legacy-2','update',?,'test-suite','meeting-legacy','Panel','2026-07-02T10:00:00-07:00','2026-07-02T11:00:00-07:00','America/Los_Angeles','completed','contact','contact-a',2,0,?,?)").run(timestamp,timestamp,timestamp);
      legacy.query("INSERT INTO meeting_history (change_id,operation,recorded_at,recorded_by,id,title,starts_at,ends_at,timezone,status,related_entity_type,related_entity_id,revision,is_deleted,created_at,updated_at) VALUES ('change-legacy-3','update',?,'test-suite','meeting-legacy','Panel','2026-07-02T10:00:00-07:00','2026-07-02T11:00:00-07:00','America/Los_Angeles','completed','person','person-b',3,0,?,?)").run(timestamp,timestamp,timestamp);
      expect(validateDatabase(legacy)).toMatchObject({ ok: true, foreignKeyViolations: 0 });
      expect(() => migrateDatabase(legacy)).toThrow(
        "Meeting participant migration requires mappings for 1 meeting(s).",
      );
      expect(legacy.query("PRAGMA table_info(meetings)").all().map(row =>
        (row as { name: string }).name)).toContain("related_entity_type");
      expect(legacy.query("SELECT name FROM sqlite_master WHERE name = 'meeting_participants'").get()).toBeNull();

      migrateDatabase(legacy, { legacyMeetingParticipants: [
        { meetingId: "meeting-legacy", personId: "person-a" },
        { meetingId: "meeting-legacy", personId: "person-b" },
      ] });

      expect(legacy.query("SELECT gig_id FROM meetings WHERE id = 'meeting-legacy'").get()).toEqual({ gig_id: "gig-legacy" });
      expect(legacy.query("SELECT id, company, revision FROM gigs WHERE id = 'gig-legacy'").get()).toEqual({ id: "gig-legacy", company: "Example", revision: 2 });
      expect(legacy.query("SELECT id, revision FROM gig_history WHERE id = 'gig-legacy'").get()).toEqual({ id: "gig-legacy", revision: 1 });
      expect(legacy.query("SELECT gig_id, revision FROM gig_people WHERE id = 'relationship-legacy'").get()).toEqual({ gig_id: "gig-legacy", revision: 2 });
      expect(legacy.query("SELECT gig_id, revision FROM gig_people_history WHERE id = 'relationship-legacy'").get()).toEqual({ gig_id: "gig-legacy", revision: 1 });
      expect(legacy.query("SELECT gig_id FROM managed_document_links").get()).toEqual({ gig_id: "gig-legacy" });
      expect(legacy.query("SELECT related_entity_type FROM tasks WHERE id = 'task-legacy'").get()).toEqual({ related_entity_type: "gig" });
      expect(legacy.query("SELECT related_entity_type FROM task_history WHERE id = 'task-legacy'").get()).toEqual({ related_entity_type: "gig" });
      expect(legacy.query("SELECT entity_type FROM business_events WHERE id = 'event-legacy'").get()).toEqual({ entity_type: "gig" });
      expect(legacy.query("SELECT revision, gig_id, legacy_related_entity_type, legacy_related_entity_id FROM meeting_history WHERE id = 'meeting-legacy' ORDER BY revision").all()).toEqual([
        { revision: 1, gig_id: "gig-legacy", legacy_related_entity_type: "job", legacy_related_entity_id: "gig-legacy" },
        { revision: 2, gig_id: null, legacy_related_entity_type: "contact", legacy_related_entity_id: "contact-a" },
        { revision: 3, gig_id: null, legacy_related_entity_type: "person", legacy_related_entity_id: "person-b" },
      ]);
      expect(legacy.query("SELECT person_id FROM meeting_participants ORDER BY person_id").all()).toEqual([{ person_id: "person-a" }, { person_id: "person-b" }]);
      const meetingColumns = legacy.query("PRAGMA table_info(meetings)").all().map(row => (row as { name: string }).name);
      expect(meetingColumns).toContain("gig_id");
      expect(meetingColumns).not.toContain("related_entity_type");
      expect(meetingColumns).not.toContain("related_entity_id");
      expect(validateDatabase(legacy)).toMatchObject({ ok: true, foreignKeyViolations: 0 });
    } finally {
      legacy.close();
    }
  });
  test("coalesces person and networking history into one ordered person stream", async () => {
    const legacy = openDatabase(":memory:");
    legacy.exec("PRAGMA foreign_keys = OFF");
    try {
      let latestMigration = "";
      for (let index = 0; index <= 11; index += 1) {
        const prefix = `${String(index).padStart(4, "0")}_`;
        const entry = [...new Bun.Glob(`${prefix}*.sql`).scanSync(path.resolve(import.meta.dir, "../drizzle"))][0];
        if (!entry) throw new Error(`Missing migration ${prefix}`);
        latestMigration = await Bun.file(path.resolve(import.meta.dir, "../drizzle", entry)).text();
        legacy.exec(latestMigration);
      }
      legacy.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
      legacy.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(
        new Bun.CryptoHasher("sha256").update(latestMigration).digest("hex"),
        1785513321577,
      );
      legacy.query("INSERT INTO changes (id,occurred_at,actor,source,summary,status) VALUES ('change-both','2026-07-01T12:00:00.000Z','candidate','user_request','Update identity and outreach','committed'),('change-outreach','2026-07-02T12:00:00.000Z','agent','agent','Clear next action','committed'),('change-identity','2026-07-03T12:00:00.000Z','candidate','user_request','Clear company','committed')").run();
      legacy.query("INSERT INTO people (id,name,company,title,revision,is_deleted,created_at,updated_at) VALUES ('person-history','Taylor New',NULL,'Director',3,0,'2026-06-01T12:00:00.000Z','2026-07-03T12:00:00.000Z'),('person-standalone','Morgan Example','Example Co','Advisor',1,0,'2026-06-05T12:00:00.000Z','2026-06-05T12:00:00.000Z')").run();
      legacy.query("INSERT INTO networking_contacts (id,person_id,relationship_type,relationship_strength,priority,status,next_action,notes_json,tags_json,revision,is_deleted,created_at,updated_at) VALUES ('contact-history','person-history','former_peer','strong','high','active_relationship',NULL,'[]','[]',3,0,'2026-06-02T12:00:00.000Z','2026-07-02T12:00:00.000Z')").run();
      legacy.query("INSERT INTO person_history (change_id,operation,recorded_at,recorded_by,id,name,company,title,revision,is_deleted,created_at,updated_at) VALUES ('change-both','update','2026-07-01T12:00:00.000Z','candidate','person-history','Taylor Old','Company','Manager',1,0,'2026-06-01T12:00:00.000Z','2026-06-01T12:00:00.000Z'),('change-identity','update','2026-07-03T12:00:00.000Z','candidate','person-history','Taylor New','Company','Director',2,0,'2026-06-01T12:00:00.000Z','2026-07-01T12:00:00.000Z')").run();
      legacy.query("INSERT INTO networking_contact_history (change_id,operation,recorded_at,recorded_by,id,person_id,relationship_type,relationship_strength,priority,status,next_action,notes_json,tags_json,revision,is_deleted,created_at,updated_at) VALUES ('change-both','update','2026-07-01T12:00:00.000Z','candidate','contact-history','person-history','former_peer','strong','high','not_contacted','Reach out','[]','[]',1,0,'2026-06-02T12:00:00.000Z','2026-06-02T12:00:00.000Z'),('change-outreach','update','2026-07-02T12:00:00.000Z','agent','contact-history','person-history','former_peer','strong','high','active_relationship','Reach out','[]','[]',2,0,'2026-06-02T12:00:00.000Z','2026-07-01T12:00:00.000Z')").run();
      legacy.query("INSERT INTO tasks (id,title,type,status,priority,related_entity_type,related_entity_id,related_entity_label,revision,is_deleted,created_at,updated_at) VALUES ('task-contact','Follow up','networking_follow_up','open','high','contact','contact-history','Taylor',1,0,?,?)").run(timestamp,timestamp);
      legacy.query("INSERT INTO business_events (id,type,entity_type,entity_id,occurred_at,summary) VALUES ('event-contact','message_received','contact','contact-history',?,'Reply')").run(timestamp);

      migrateDatabase(legacy);

      expect(legacy.query("SELECT name FROM sqlite_master WHERE name LIKE 'networking_%'").all()).toEqual([]);
      expect(legacy.query("SELECT id,name,company,status,next_action,revision,created_at,updated_at FROM people WHERE id = 'person-history'").get()).toEqual({
        id: "person-history", name: "Taylor New", company: null, status: "active_relationship",
        next_action: null, revision: 4, created_at: "2026-06-01T12:00:00.000Z",
        updated_at: "2026-07-03T12:00:00.000Z",
      });
      expect(legacy.query("SELECT relationship_type,relationship_strength,priority,status,last_contacted,next_action,notes_json,tags_json,revision FROM people WHERE id = 'person-standalone'").get()).toEqual({
        relationship_type: "professional_contact", relationship_strength: "unknown",
        priority: "unranked", status: "not_contacted", last_contacted: null,
        next_action: null, notes_json: "[]", tags_json: "[]", revision: 1,
      });
      expect(legacy.query("SELECT change_id,operation,recorded_at,revision,name,company,status,next_action,recorded_by FROM person_history WHERE id = 'person-history' ORDER BY revision").all()).toEqual([
        { change_id: "change-both", operation: "update", recorded_at: "2026-07-01T12:00:00.000Z", revision: 1, name: "Taylor Old", company: "Company", status: "not_contacted", next_action: "Reach out", recorded_by: "candidate" },
        { change_id: "change-outreach", operation: "update", recorded_at: "2026-07-02T12:00:00.000Z", revision: 2, name: "Taylor New", company: "Company", status: "active_relationship", next_action: "Reach out", recorded_by: "agent" },
        { change_id: "change-identity", operation: "update", recorded_at: "2026-07-03T12:00:00.000Z", revision: 3, name: "Taylor New", company: "Company", status: "active_relationship", next_action: null, recorded_by: "candidate" },
      ]);
      expect(legacy.query("SELECT related_entity_type,related_entity_id FROM tasks WHERE id = 'task-contact'").get()).toEqual({ related_entity_type: "person", related_entity_id: "person-history" });
      expect(legacy.query("SELECT entity_type,entity_id FROM business_events WHERE id = 'event-contact'").get()).toEqual({ entity_type: "person", entity_id: "person-history" });
      expect(validateDatabase(legacy)).toMatchObject({ ok: true, foreignKeyViolations: 0 });
    } finally {
      legacy.close();
    }
  });
  test("enables foreign key enforcement", () => { expect((database.query("PRAGMA foreign_keys").get() as {foreign_keys:number}).foreign_keys).toBe(1); });
  test("enforces binary deletion and history operation constraints", () => {
    expect(() => database.query("INSERT INTO tasks (id,title,type,status,priority,related_entity_type,related_entity_label,revision,is_deleted,created_at,updated_at) VALUES ('bad','Bad','other','open','low','general','General',1,2,?,?)").run(timestamp,timestamp)).toThrow();
    store.change(context("Create task"), (tx) => tx.tasks.create(task));
    const changeId = (database.query("SELECT id FROM changes").get() as {id:string}).id;
    expect(() => database.query("INSERT INTO task_history (change_id,operation,recorded_at,recorded_by,id,title,type,status,priority,related_entity_type,related_entity_label,revision,is_deleted,created_at,updated_at) VALUES (?,'invalid',?,?,'bad','Bad','other','open','low','general','General',1,0,?,?)").run(changeId,timestamp,"test-suite",timestamp,timestamp)).toThrow();
  });
  test("persists migrated data across a file-backed database reopen", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gig-finder-data-test-"));
    const filename = path.join(directory, "test.sqlite");
    try {
      const first = openDatabase(filename);
      migrateDatabase(first);
      const firstStore = new DataStore(first);
      firstStore.change(context("Persist task"), (tx) => tx.tasks.create(task));
      firstStore.settings.set("agent_model", "gpt-5.6-luna");
      first.close();

      const second = openDatabase(filename, { create:false });
      migrateDatabase(second);
      const secondStore = new DataStore(second);
      expect(secondStore.tasks.get(task.id)?.title).toBe(task.title);
      expect(secondStore.settings.get("agent_model")).toBe("gpt-5.6-luna");
      second.close();
    } finally { await rm(directory, { recursive:true, force:true }); }
  });
});

describe("typed CRUD repositories", () => {
  test("persists application settings independently of entity history", () => {
    expect(store.settings.get("agent_model")).toBeNull();
    store.settings.set("agent_model", "gpt-5.6-terra");
    expect(store.settings.get("agent_model")).toBe("gpt-5.6-terra");
    expect((database.query("SELECT count(*) count FROM changes").get() as { count: number }).count).toBe(0);
  });
  test("creates and reads gigs with initial metadata", () => {
    const result = store.change(context("Create gig"), (tx) => tx.gigs.create(gig));
    expect(result.value).toMatchObject({ id:"gig-1", revision:1, isDeleted:false, createdAt:timestamp, updatedAt:timestamp });
    expect(store.gigs.get("gig-1")?.company).toBe("Company");
    expect(store.gigs.list()).toHaveLength(1);
  });
  test("supports people, tasks, and meetings through the same transaction library", () => {
    store.change(context("Create records"), (tx) => ({ person:tx.people.create(person), task:tx.tasks.create(task), meeting:tx.meetings.create(meeting), participant:tx.meetingParticipants.create(meetingParticipant) }));
    expect(store.people.get("person-1")?.title).toBe("CTO");
    expect(store.tasks.get("task-1")?.priority).toBe("high");
    expect(store.meetings.get("meeting-1")?.externalEventId).toBe("google-1");
    expect(store.meetingParticipants.get(meetingParticipant.id)?.personId).toBe(person.id);
  });
  test("rejects duplicate IDs and rolls back the failed change record", () => {
    store.change(context("Create gig"), (tx) => tx.gigs.create(gig));
    expect(() => store.change(context("Duplicate gig"), (tx) => tx.gigs.create(gig))).toThrow("already exists");
    expect((database.query("SELECT count(*) count FROM changes").get() as {count:number}).count).toBe(1);
  });
  test("read operations never create change records", () => {
    store.gigs.get("missing"); store.gigs.list();
    expect((database.query("SELECT count(*) count FROM changes").get() as {count:number}).count).toBe(0);
  });
  test("shared read services traverse persisted records without changing operational or audit state", async () => {
    store.change(context("Create records"), (tx) => {
      tx.gigs.create(gig);
      tx.people.create(person);
      tx.gigPeople.create({ id: "relationship-1", gigId: gig.id, personId: person.id, relationship: "hiring_manager", notes: null });
      tx.tasks.create(task);
    });
    const artifacts = {
      jobDescription: async () => "",
      interviewPrep: async () => [],
      jobDescriptionExists: async () => false,
      interviewPrepExists: async () => false,
      verify: async () => ({ ok: true, errors: [], unregistered: [] }),
    } satisfies ArtifactPort;
    const app = new GigFinderApplication(store, new AuditReader(database), artifacts);
    const before = database.serialize();

    app.gigs.query({ stages: ["applied"], limit: 10 });
    app.gigs.read(gig.id);
    app.people.query({ statuses: ["not_contacted"] });
    app.people.query({ query: "CTO" });
    app.people.read(person.id);
    expect(app.gigPeople.query({ gigIds: [gig.id], personIds: [person.id] }))
      .toMatchObject({ status: "ok", items: [{ id: "relationship-1" }] });
    expect(app.gigPeople.peopleForGig(gig.id)).toMatchObject({
      status: "ok",
      record: { items: [{ id: person.id }] },
    });
    expect(app.gigPeople.gigsForPerson(person.id)).toMatchObject({
      status: "ok",
      record: { items: [{ id: gig.id }] },
    });
    app.tasks.query({ statuses: ["open"] });
    app.tasks.read(task.id);

    expect(database.serialize()).toEqual(before);
  });
});

describe("full-row history and revisions", () => {
  test("copies the complete pre-update gig and increments the live revision", () => {
    store.change(context("Create gig"), (tx) => tx.gigs.create(gig));
    const updated = store.change({ ...context("Apply"), occurredAt:"2026-07-22T10:00:00.000Z" }, (tx) => tx.gigs.update("gig-1", 1, { stage:"applied", statusSummary:"Applied" }));
    expect(updated.value).toMatchObject({ stage:"applied", statusSummary:"Applied", revision:2 });
    const history = database.query("SELECT * FROM gig_history WHERE id = 'gig-1'").get() as Record<string,unknown>;
    expect(history).toMatchObject({ stage:"identified", status_summary:"Identified", revision:1, operation:"update", recorded_by:"test-suite", change_id:updated.changeId });
    expect(history.company).toBe(gig.company); expect(history.tags_json).toBe(gig.tagsJson);
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
    store.change(context("Create gig"), (tx) => tx.gigs.create(gig));
    expect(() => store.change(context("Stale update"), (tx) => tx.gigs.update("gig-1", 9, { title:"Wrong" }))).toThrow(RevisionConflictError);
    expect((database.query("SELECT count(*) count FROM gig_history").get() as {count:number}).count).toBe(0);
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
  test("records participant changes in the standard full-row history", () => {
    const secondPerson = { ...person, id: "person-2", name: "Person Two" };
    store.change(context("Create meeting participants"), tx => {
      tx.people.create(person);
      tx.people.create(secondPerson);
      tx.meetings.create(meeting);
      tx.meetingParticipants.create(meetingParticipant);
    });
    const result = store.change(context("Change meeting participant"), tx => {
      tx.meetingParticipants.delete(meetingParticipant.id, 1);
      return tx.meetingParticipants.create({
        id: "meeting-1::person-2",
        meetingId: meeting.id,
        personId: secondPerson.id,
      });
    });
    expect(result.value).toMatchObject({ personId: "person-2", revision: 1 });
    expect(database.query("SELECT person_id, revision, operation, change_id FROM meeting_participant_history").get()).toEqual({
      person_id: "person-1",
      revision: 1,
      operation: "delete",
      change_id: result.changeId,
    });
  });
  test("meeting service replaces participants atomically with one audited change", () => {
    const secondPerson = { ...person, id: "person-2", name: "Person Two" };
    const artifacts = {
      jobDescription: async () => "",
      interviewPrep: async () => [],
      jobDescriptionExists: async () => false,
      interviewPrepExists: async () => false,
      verify: async () => ({ ok: true, errors: [], unregistered: [] }),
    } satisfies ArtifactPort;
    const app = new GigFinderApplication(store, new AuditReader(database), artifacts);
    app.people.create(context("Create first person"), person);
    app.people.create(context("Create second person"), secondPerson);
    const created = app.meetings.create({
      ...context("Create meeting"),
      changeId: "meeting-create-change",
    }, {
      ...meeting,
      personIds: [person.id],
      status: "confirmed",
    });
    expect(created).toMatchObject({
      changeId: "meeting-create-change",
      record: { personIds: [person.id] },
    });

    const updated = app.meetings.update({
      ...context("Complete meeting"),
      changeId: "meeting-update-change",
    }, meeting.id, {
      status: "completed",
      personIds: [secondPerson.id],
      location: null,
    });

    expect(updated).toMatchObject({
      changeId: "meeting-update-change",
      record: {
        status: "completed",
        personIds: [secondPerson.id],
        location: null,
      },
    });
    expect(app.meetings.get(meeting.id)).toMatchObject({
      status: "completed",
      personIds: [secondPerson.id],
      location: null,
    });
    expect(database.query("SELECT change_id, status, location FROM meeting_history WHERE id = ?").get(meeting.id)).toEqual({
      change_id: "meeting-update-change",
      status: "confirmed",
      location: "Seattle",
    });
    expect(database.query("SELECT change_id, operation, person_id FROM meeting_participant_history WHERE meeting_id = ?").get(meeting.id)).toEqual({
      change_id: "meeting-update-change",
      operation: "delete",
      person_id: person.id,
    });
    app.meetings.update({
      ...context("Restore first participant"),
      changeId: "meeting-restore-participant",
    }, meeting.id, {
      personIds: [person.id],
    });
    expect(app.meetings.get(meeting.id)?.personIds).toEqual([person.id]);
    expect(store.meetingParticipants.get(
      `meeting-participant:${meeting.id.length}:${meeting.id}${person.id}`,
    )).toMatchObject({ personId: person.id, revision: 3, isDeleted: false });
    expect(() => app.meetings.update(context("Invalid participants"), meeting.id, {
      personIds: ["missing-person"],
    })).toThrow("references missing person missing-person");
    expect(app.meetings.get(meeting.id)?.personIds).toEqual([person.id]);
  });

  test("meeting participant additions, removals, and replacements are reversible", () => {
    const secondPerson = { ...person, id: "person-2", name: "Person Two" };
    const artifacts = {
      jobDescription: async () => "",
      interviewPrep: async () => [],
      jobDescriptionExists: async () => false,
      interviewPrepExists: async () => false,
      verify: async () => ({ ok: true, errors: [], unregistered: [] }),
    } satisfies ArtifactPort;
    const app = new GigFinderApplication(store, new AuditReader(database), artifacts);
    app.people.create(context("Create first person"), person);
    app.people.create(context("Create second person"), secondPerson);
    app.meetings.create(context("Create meeting"), {
      ...meeting,
      personIds: [person.id],
      status: "confirmed",
    });

    const addition = app.meetings.update({
      ...context("Add participant"),
      changeId: "meeting-add-participant",
    }, meeting.id, { personIds: [person.id, secondPerson.id] });
    expect(addition.record).toMatchObject({
      revision: 2,
      personIds: [person.id, secondPerson.id],
    });
    app.changes.revert({
      ...context("Revert participant addition"),
      changeId: "meeting-revert-addition",
    }, "meeting-add-participant");
    expect(app.meetings.get(meeting.id)).toMatchObject({
      revision: 3,
      personIds: [person.id],
    });

    app.meetings.update({
      ...context("Add participant again"),
      changeId: "meeting-add-participant-again",
    }, meeting.id, { personIds: [person.id, secondPerson.id] });
    app.meetings.update({
      ...context("Remove participant"),
      changeId: "meeting-remove-participant",
    }, meeting.id, { personIds: [person.id] });
    app.changes.revert({
      ...context("Revert participant removal"),
      changeId: "meeting-revert-removal",
    }, "meeting-remove-participant");
    expect(app.meetings.get(meeting.id)?.personIds).toEqual([person.id, secondPerson.id]);

    app.meetings.update({
      ...context("Replace participant"),
      changeId: "meeting-replace-participant",
    }, meeting.id, { personIds: [secondPerson.id] });
    app.changes.revert({
      ...context("Revert participant replacement"),
      changeId: "meeting-revert-replacement",
    }, "meeting-replace-participant");
    expect(app.meetings.get(meeting.id)?.personIds).toEqual([person.id, secondPerson.id]);
    expect(validateDatabase(database)).toMatchObject({ ok: true, issues: [] });
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
  test("deletes gigs and tasks without removing their live rows", () => {
    store.change(context("Create records"), (tx) => { tx.gigs.create(gig); tx.tasks.create(task); });
    store.change(context("Delete records"), (tx) => { tx.gigs.delete(gig.id, 1); tx.tasks.delete(task.id, 1); });
    expect(store.gigs.get(gig.id)).toBeNull(); expect(store.tasks.get(task.id)).toBeNull();
    expect(store.gigs.get(gig.id, {includeDeleted:true})).toMatchObject({isDeleted:true,revision:2});
    expect(store.tasks.get(task.id, {includeDeleted:true})).toMatchObject({isDeleted:true,revision:2});
    expect(database.query("SELECT operation FROM gig_history").get()).toEqual({operation:"delete"});
    expect(database.query("SELECT operation FROM task_history").get()).toEqual({operation:"delete"});
  });
});

describe("change envelopes, business events, and evidence", () => {
  test("ties multiple records and events to one change ID", () => {
    const result = store.change(context("Record application and follow-up"), (tx) => {
      tx.gigs.create(gig); tx.tasks.create(task);
      return tx.recordEvent({ type:"application_submitted", entityType:"gig", entityId:gig.id, occurredAt:timestamp, summary:"Applied", sources:[{ sourceSystem:"gmail", externalId:"message-1", sourceTimestamp:timestamp, sourceUri:"https://mail.google.com/message-1", importedAt:timestamp, contentHash:"abc", excerpt:"Application received" }] });
    });
    expect((database.query("SELECT change_id FROM business_events").get() as {change_id:string}).change_id).toBe(result.changeId);
    expect(database.query("SELECT source_system, external_id FROM event_sources").get()).toEqual({source_system:"gmail",external_id:"message-1"});
    expect(database.query("SELECT actor, source, summary FROM changes WHERE id = ?").get(result.changeId)).toEqual({ actor:"test-suite", source:"test", summary:"Record application and follow-up" });
  });
  test("uses one shared change ID for multiple history snapshots", () => {
    store.change(context("Create records"), (tx) => { tx.gigs.create(gig); tx.tasks.create(task); });
    const result = store.change(context("Advance records"), (tx) => { tx.gigs.update(gig.id, 1, { stage:"applied" }); tx.tasks.update(task.id, 1, { status:"completed", completedAt:"2026-07-21" }); });
    expect((database.query("SELECT change_id FROM gig_history").get() as {change_id:string}).change_id).toBe(result.changeId);
    expect((database.query("SELECT change_id FROM task_history").get() as {change_id:string}).change_id).toBe(result.changeId);
  });
  test("rolls back all records, history, events, sources, and the change on failure", () => {
    expect(() => store.change(context("Fail everything"), (tx) => { tx.gigs.create(gig); tx.recordEvent({ type:"role_identified", entityType:"gig", entityId:gig.id, occurredAt:timestamp, summary:"Found", sources:[{sourceSystem:"scout",externalId:"role-1",importedAt:timestamp}] }); throw new Error("boom"); })).toThrow("boom");
    for (const table of ["gigs","changes","business_events","event_sources","gig_history"]) expect((database.query(`SELECT count(*) count FROM ${table}`).get() as {count:number}).count).toBe(0);
  });
  test("rolls back record updates and their snapshots together", () => {
    store.change(context("Create records"), (tx) => { tx.gigs.create(gig); tx.tasks.create(task); });
    expect(() => store.change(context("Failed update"), (tx) => { tx.gigs.update(gig.id, 1, { stage:"applied" }); tx.tasks.update(task.id, 1, { status:"completed", completedAt:"2026-07-21" }); throw new Error("stop"); })).toThrow("stop");
    expect(store.gigs.get(gig.id)).toMatchObject({stage:"identified",revision:1});
    expect(store.tasks.get(task.id)).toMatchObject({status:"open",revision:1});
    expect((database.query("SELECT count(*) count FROM gig_history").get() as {count:number}).count).toBe(0);
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

describe("change idempotency and reversal", () => {
  test("rejects a duplicate explicit change ID before applying a retry", () => {
    store.change(context("Create gig"), tx => tx.gigs.create(gig));
    const updateContext: ChangeContext = {
      actor: "Candidate",
      source: "user_request",
      summary: "Update gig",
      changeId: "change:update-gig",
    };
    store.change(updateContext, tx =>
      tx.gigs.update(gig.id, 1, { statusSummary: "Updated once" }));
    expect(() => store.change(updateContext, tx =>
      tx.gigs.update(gig.id, 2, { statusSummary: "Updated twice" })))
      .toThrow(MutationError);
    expect(store.gigs.get(gig.id)).toMatchObject({
      revision: 2,
      statusSummary: "Updated once",
    });
  });
  test("task service persists audited server dates and rejects duplicate change IDs", () => {
    const artifacts = {
      jobDescription: async () => "",
      interviewPrep: async () => [],
      jobDescriptionExists: async () => false,
      interviewPrepExists: async () => false,
      verify: async () => ({ ok: true, errors: [], unregistered: [] }),
    } satisfies ArtifactPort;
    const app = new GigFinderApplication(store, new AuditReader(database), artifacts);
    store.change(context("Create gig"), tx => tx.gigs.create(gig));
    const createContext = {
      actor: "Candidate",
      source: "agent" as const,
      summary: "Create follow-up",
      occurredAt: "2026-08-01T09:00:00-07:00",
      changeId: "agent-tool:create-task",
    };
    const input = {
      id: "task-audited",
      title: "Review role",
      type: "application" as const,
      priority: null,
      dueDate: null,
      relatedEntity: { type: "gig" as const, id: gig.id },
      notes: null,
    };
    const created = app.tasks.createNew(createContext, input);
    expect(created).toMatchObject({
      changeId: "agent-tool:create-task",
      record: {
        createdAt: "2026-08-01",
        updatedAt: "2026-08-01",
        relatedEntity: { label: "Company VP Engineering" },
      },
    });
    expect(() => app.tasks.createNew(createContext, { ...input, id: "task-duplicate" }))
      .toThrow(new MutationError("duplicate_change", "Change has already been applied: agent-tool:create-task"));

    const updated = app.tasks.update({
      ...createContext,
      occurredAt: "2026-08-02T09:00:00-07:00",
      changeId: "agent-tool:update-task",
    }, input.id, { status: "completed" });
    expect(updated).toMatchObject({
      changeId: "agent-tool:update-task",
      record: { status: "completed", completedAt: "2026-08-02", updatedAt: "2026-08-02" },
    });
    expect(database.query("SELECT change_id, revision FROM task_history WHERE id = ?").all(input.id))
      .toEqual([{ change_id: "agent-tool:update-task", revision: 1 }]);
  });

  test("reverts a gig update as a new audited revision", () => {
    store.change(context("Create gig"), tx => tx.gigs.create(gig));
    store.change({
      actor: "Candidate",
      source: "user_request",
      summary: "Update gig",
      changeId: "change:update-gig",
    }, tx => tx.gigs.update(gig.id, 1, {
      stage: "applied",
      statusSummary: "Application submitted",
    }));

    const reverted = store.revertChange({
      actor: "Candidate",
      source: "user_request",
      summary: "Revert gig update",
      changeId: "change:revert-gig",
    }, "change:update-gig");

    expect(reverted.value).toEqual([{ entity: "gig", id: gig.id }]);
    expect(store.gigs.get(gig.id)).toMatchObject({
      revision: 3,
      stage: "identified",
      statusSummary: "Identified",
    });
    expect(database.query(
      "SELECT parent_change_id FROM changes WHERE id = 'change:revert-gig'",
    ).get()).toEqual({ parent_change_id: "change:update-gig" });
    expect(database.query(
      "SELECT change_id, revision FROM gig_history ORDER BY history_id",
    ).all()).toEqual([
      { change_id: "change:update-gig", revision: 1 },
      { change_id: "change:revert-gig", revision: 2 },
    ]);
    expect(() => store.revertChange({
      actor: "Candidate",
      source: "user_request",
      summary: "Retry revert",
      changeId: "change:revert-gig",
    }, "change:update-gig")).toThrow("already been applied");
  });

  test("reverts identity and outreach fields in one person revision", () => {
    store.change(context("Create person"), tx => tx.people.create(person));
    store.change({
      actor: "Candidate",
      source: "user_request",
      summary: "Update contact",
      changeId: "change:update-contact",
    }, tx => {
      tx.people.update(person.id, 1, { title: "Chief Product Officer", status: "active_relationship" });
    });

    store.revertChange({
      actor: "Candidate",
      source: "user_request",
      summary: "Revert contact",
      changeId: "change:revert-contact",
    }, "change:update-contact");

    expect(store.people.get(person.id)).toMatchObject({ title: "CTO", status: "not_contacted", revision: 3 });
  });

  test("uses the same reversal mechanism for another repository", () => {
    store.change(context("Create task"), tx => tx.tasks.create(task));
    store.change({
      actor: "Candidate",
      source: "user_request",
      summary: "Complete task",
      changeId: "change:complete-task",
    }, tx => tx.tasks.update(task.id, 1, {
      status: "completed",
      completedAt: "2026-07-22",
    }));

    const reverted = store.revertChange({
      actor: "Candidate",
      source: "user_request",
      summary: "Reopen task",
      changeId: "change:reopen-task",
    }, "change:complete-task");

    expect(reverted.value).toEqual([{ entity: "task", id: task.id }]);
    expect(store.tasks.get(task.id)).toMatchObject({
      revision: 3,
      status: "open",
      completedAt: null,
    });
  });

  test("rejects a revert when a later edit would be overwritten", () => {
    store.change(context("Create gig"), tx => tx.gigs.create(gig));
    store.change({
      actor: "Candidate",
      source: "user_request",
      summary: "Update gig",
      changeId: "change:update-conflict",
    }, tx => tx.gigs.update(gig.id, 1, { statusSummary: "First update" }));
    store.change(context("Later edit"), tx =>
      tx.gigs.update(gig.id, 2, { statusSummary: "Later edit" }));

    expect(() => store.revertChange({
      actor: "Candidate",
      source: "user_request",
      summary: "Unsafe revert",
      changeId: "change:revert-conflict",
    }, "change:update-conflict")).toThrow("immediately preceding revision");
    expect(store.gigs.get(gig.id)).toMatchObject({
      revision: 3,
      statusSummary: "Later edit",
    });
  });
});
