import { describe, expect, test } from "bun:test";
import { JobSearchApplication } from "../src/application";
import type {
  ArtifactPort,
  ArtifactVerification,
  AuditPort,
  DocumentWriteRepository,
  Persistence,
  ReadRepository,
  UnitOfWork,
} from "../src/ports";
import type {
  ChangeContext,
  EntityRecord,
  JobData,
  JobPersonData,
  MeetingData,
  MeetingParticipantData,
  NetworkingContactData,
  PersonData,
  TaskData,
} from "../src/models";
import type {
  DocumentLinkEntityType,
  ManagedDocumentData,
  ManagedDocumentRecord,
  ManagedDocumentVersionData,
} from "../src/documents";

const metadata = {
  revision: 1,
  isDeleted: false,
  createdAt: "2026-07-30T12:00:00-07:00",
  updatedAt: "2026-07-30T12:00:00-07:00",
};

class Repo<T extends { id: string }> implements ReadRepository<T> {
  rows = new Map<string, EntityRecord<T>>();
  get(id: string) { return this.rows.get(id) ?? null; }
  list() { return [...this.rows.values()].filter(record => !record.isDeleted); }
  create(record: T) {
    const value = { ...record, ...metadata };
    this.rows.set(record.id, value);
    return value;
  }
  update(id: string, revision: number, patch: Partial<Omit<T, "id">>) {
    const current = this.get(id)!;
    const value = { ...current, ...patch, revision: revision + 1 };
    this.rows.set(id, value);
    return value;
  }
  delete(id: string) { return this.rows.get(id)!; }
  restore(id: string) { return this.rows.get(id)!; }
}

class EmptyDocuments implements DocumentWriteRepository {
  get() { return null; }
  list(_entityType: DocumentLinkEntityType, _entityId: string) { return []; }
  listVersions(): ManagedDocumentVersionData[] { return []; }
  create(_input: { document: ManagedDocumentData; content: string; contentHash: string }): ManagedDocumentRecord {
    throw new Error("not used");
  }
  addVersion(_input: { documentId: string; expectedVersion: number; content: string; contentHash: string; changeSummary: string }): ManagedDocumentRecord {
    throw new Error("not used");
  }
}

const artifacts: ArtifactPort = {
  jobDescription: async () => "description",
  interviewPrep: async () => [],
  jobDescriptionExists: async () => false,
  interviewPrepExists: async () => false,
  verify: async (): Promise<ArtifactVerification> => ({ ok: true, errors: [], unregistered: [] }),
};
const audit: AuditPort = { query: () => null };
const context: ChangeContext = { actor: "test", source: "test", summary: "seed" };

function application() {
  const jobs = new Repo<JobData>();
  const people = new Repo<PersonData>();
  const networking = new Repo<NetworkingContactData>();
  const jobPeople = new Repo<JobPersonData>();
  const tasks = new Repo<TaskData>();
  const meetings = new Repo<MeetingData>();
  const meetingParticipants = new Repo<MeetingParticipantData>();
  const documents = new EmptyDocuments();
  let readChanges = 0;
  const persistence: Persistence = {
    jobs,
    people,
    networking,
    jobPeople,
    tasks,
    meetings,
    meetingParticipants,
    documents,
    change: (changeContext, action) => {
      readChanges += 1;
      return {
        changeId: changeContext.changeId ?? "change",
        value: action({
          jobs,
          people,
          networking,
          jobPeople,
          tasks,
          meetings,
          meetingParticipants,
          documents,
          recordEvent: event => event.id ?? event.type,
        } as UnitOfWork),
      };
    },
    revertChange: () => ({ changeId: "revert", value: [] }),
  };
  return {
    app: new JobSearchApplication(persistence, audit, artifacts),
    repos: { jobs, people, networking, jobPeople, tasks, meetings, meetingParticipants },
    changes: () => readChanges,
  };
}

const job = (id: string, company: string, stage: JobData["stage"] = "applied"): JobData => ({
  id,
  company,
  title: `${company} Director`,
  externalJobId: null,
  stage,
  outcome: "pending",
  statusSummary: "Active",
  lastActivity: "2026-07-29",
  nextActionDescription: null,
  nextActionDue: null,
  fitRating: "good",
  fitSummary: null,
  payCurrency: null,
  payMinimum: null,
  payMaximum: null,
  payPeriod: null,
  payNotes: null,
  sourceUrl: null,
  location: null,
  workArrangement: null,
  postedDate: null,
  businessUnitTeam: null,
  recruiterSource: null,
  bonus: null,
  equity: null,
  otherCompensation: null,
  tagsJson: "[]",
  hasJobDescription: false,
  hasInterviewPrep: false,
});

const meeting = (
  id: string,
  startsAt: string,
  overrides: Partial<MeetingData> = {},
): MeetingData => ({
  id,
  title: "Interview",
  startsAt,
  endsAt: startsAt,
  timezone: "America/Los_Angeles",
  location: "Video",
  description: "Platform conversation",
  status: "confirmed",
  jobId: null,
  externalCalendarId: null,
  externalEventId: null,
  ...overrides,
});

describe("caller-neutral read services", () => {
  test("jobs and tasks apply defaults, pagination, and list/get field parity", () => {
    const { app, repos, changes } = application();
    repos.jobs.create(job("job-b", "Beta"));
    repos.jobs.create(job("job-a", "Alpha", "identified"));
    repos.tasks.create({
      id: "task-1",
      title: "Follow up",
      type: "networking_follow_up",
      status: "open",
      priority: "high",
      dueDate: null,
      relatedEntityType: "general",
      relatedEntityId: null,
      relatedEntityLabel: "General",
      notes: null,
      completedAt: null,
    });
    const before = changes();
    expect(app.jobs.query({}).items.map(record => record.id)).toEqual(["job-b"]);
    const all = app.jobs.query({ query: "Alpha", offset: 0, limit: 1 });
    const readJob = app.jobs.read("job-a");
    expect(all).toMatchObject({ page: { returned: 1, total: 1, hasMore: false } });
    expect(Object.keys(all.items[0]!).sort()).toEqual(
      Object.keys(readJob.status === "ok" ? readJob.record : {}).sort(),
    );
    const tasks = app.tasks.query({});
    const readTask = app.tasks.read("task-1");
    expect(tasks.items).toHaveLength(1);
    expect(readTask.status).toBe("ok");
    if (readTask.status !== "ok") throw new Error("Expected task read to succeed");
    expect(tasks.items[0]).toEqual(readTask.record);
    expect(() => app.jobs.query({ limit: 51 })).toThrow("Page limit must be an integer from 1 to 50.");
    expect(changes()).toBe(before);
  });

  test("people search includes standalone people and contact IDs remain distinct", () => {
    const { app, repos } = application();
    repos.people.create({ id: "person-standalone", name: "Standalone Person", company: "Acme", title: "CTO", linkedInProfileUrl: null, connectedOn: null });
    repos.people.create({ id: "person-contact", name: "Contact Person", company: "Beta", title: "Recruiter", linkedInProfileUrl: null, connectedOn: null });
    repos.networking.create({ id: "contact-record", personId: "person-contact", relationshipType: "recruiter", relationshipStrength: "warm", introducedBy: null, relationshipNotes: null, priority: "high", status: "active_relationship", lastContacted: null, lastContactMethod: null, lastContactSummary: null, nextAction: null, nextActionDue: null, whyInteresting: null, notesJson: "[]", tagsJson: "[]" });
    expect(app.people.query({ query: "acme" }).items.map(person => person.id)).toEqual(["person-standalone"]);
    const contactRead = app.networking.read("contact-record");
    expect(contactRead).toMatchObject({
      status: "ok",
      record: { id: "contact-record", personId: "person-contact" },
    });
    const listedPerson = app.people.query({ query: "Standalone" }).items[0]!;
    const readPerson = app.people.read("person-standalone");
    expect(readPerson.status).toBe("ok");
    if (readPerson.status !== "ok") throw new Error("Expected person read to succeed");
    expect(Object.keys(listedPerson).sort()).toEqual(Object.keys(readPerson.record).sort());
    const listedContact = app.networking.query({ statuses: ["active_relationship"] }).items[0]!;
    if (contactRead.status !== "ok") throw new Error("Expected contact read to succeed");
    expect(Object.keys(listedContact).sort()).toEqual(Object.keys(contactRead.record).sort());
    app.networking.update(context, "contact-record", { status: "follow_up_due" });
    expect(repos.networking.get("contact-record")?.personId).toBe("person-contact");
  });

  test("relationships support multi-value filters and both traversal directions", () => {
    const { app, repos } = application();
    repos.jobs.create(job("job-1", "Alpha"));
    repos.jobs.create(job("job-2", "Beta"));
    repos.people.create({ id: "person-1", name: "Alex", company: "Alpha", title: "VP", linkedInProfileUrl: null, connectedOn: null });
    repos.people.create({ id: "person-2", name: "Blair", company: "Beta", title: "Recruiter", linkedInProfileUrl: null, connectedOn: null });
    repos.jobPeople.create({ id: "rel-1", jobId: "job-1", personId: "person-1", relationship: "hiring_manager", notes: null });
    repos.jobPeople.create({ id: "rel-2", jobId: "job-1", personId: "person-2", relationship: "recruiter", notes: null });
    repos.jobPeople.create({ id: "rel-3", jobId: "job-2", personId: "person-1", relationship: "former_peer", notes: null });
    repos.jobPeople.create({ id: "rel-4", jobId: "job-2", personId: "person-2", relationship: "professional_contact", notes: null });
    const relationships = app.jobPeople.query({
      jobIds: ["job-1", "job-2"],
      personIds: ["person-1"],
      relationships: ["hiring_manager", "former_peer"],
    });
    expect(relationships).toMatchObject({ status: "ok", items: [{ id: "rel-1" }, { id: "rel-3" }] });
    const readRelationship = app.jobPeople.read("rel-1");
    expect(readRelationship.status).toBe("ok");
    expect(app.jobPeople.read("rel-4")).toMatchObject({
      status: "ok",
      record: { relationship: "professional_contact" },
    });
    if (relationships.status !== "ok" || readRelationship.status !== "ok") {
      throw new Error("Expected relationship reads to succeed");
    }
    expect(Object.keys(relationships.items[0]!).sort())
      .toEqual(Object.keys(readRelationship.record).sort());
    expect(app.jobPeople.peopleForJob("job-1")).toMatchObject({
      status: "ok",
      record: { items: [{ id: "person-1" }, { id: "person-2" }] },
    });
    expect(app.jobPeople.jobsForPerson("person-1")).toMatchObject({
      status: "ok",
      record: { items: [{ id: "job-1" }, { id: "job-2" }] },
    });
  });

  test("relationship reads distinguish missing records from broken stored links", () => {
    const { app, repos } = application();
    expect(app.jobPeople.read("missing")).toEqual({ status: "not_found", id: "missing" });
    repos.jobPeople.create({ id: "broken", jobId: "missing-job", personId: "missing-person", relationship: "recruiter", notes: null });
    expect(app.jobPeople.read("broken")).toMatchObject({
      status: "consistency_error",
      id: "broken",
      message: expect.stringContaining("missing job"),
    });
    repos.jobPeople.create({ id: "invalid", jobId: "missing-job", personId: "missing-person", relationship: "friend", notes: null });
    expect(app.jobPeople.query({})).toMatchObject({
      status: "consistency_error",
      id: "invalid",
      message: expect.stringContaining("unsupported relationship"),
    });
  });

  test("meetings compose every participant and support multi-value filters", () => {
    const { app, repos, changes } = application();
    repos.jobs.create(job("job-1", "Alpha"));
    repos.jobs.create(job("job-2", "Beta"));
    repos.people.create({ id: "person-1", name: "Alex", company: "Alpha", title: "VP", linkedInProfileUrl: null, connectedOn: null });
    repos.people.create({ id: "person-2", name: "Blair", company: "Beta", title: "Recruiter", linkedInProfileUrl: null, connectedOn: null });
    repos.meetings.create(meeting("meeting-old", "2026-07-10T10:00:00-07:00", { jobId: "job-1" }));
    repos.meetings.create(meeting("meeting-new", "2026-07-20T10:00:00-07:00", { title: "Coffee", status: "completed", jobId: "job-2", description: "Leadership discussion" }));
    repos.meetingParticipants.create({ id: "meeting-old::person-1", meetingId: "meeting-old", personId: "person-1" });
    repos.meetingParticipants.create({ id: "meeting-new::person-1", meetingId: "meeting-new", personId: "person-1" });
    repos.meetingParticipants.create({ id: "meeting-new::person-2", meetingId: "meeting-new", personId: "person-2" });
    const before = changes();

    const all = app.meetings.query({});
    expect(all).toMatchObject({ status: "ok", items: [{ id: "meeting-new" }, { id: "meeting-old" }] });
    const filtered = app.meetings.query({
      personIds: ["person-2", "person-missing"],
      jobIds: ["job-1", "job-2"],
      statuses: ["completed"],
      startsFrom: "2026-07-20T10:00:00-07:00",
      startsThrough: "2026-07-20T10:00:00-07:00",
      query: "leadership",
      offset: 0,
      limit: 1,
    });
    expect(filtered).toMatchObject({
      status: "ok",
      items: [{ id: "meeting-new", jobId: "job-2", personIds: ["person-1", "person-2"] }],
      page: { returned: 1, total: 1, hasMore: false },
    });
    const read = app.meetings.read("meeting-new");
    expect(read.status).toBe("ok");
    if (read.status !== "ok" || filtered.status !== "ok") throw new Error("Expected meeting reads to succeed");
    expect(filtered.items[0]).toEqual(read.record);
    expect(app.meetings.read("missing")).toEqual({ status: "not_found", id: "missing" });
    expect(changes()).toBe(before);
  });

  test("meeting date filters and ordering compare absolute instants", () => {
    const { app, repos } = application();
    repos.people.create({ id: "person-1", name: "Alex", company: null, title: null, linkedInProfileUrl: null, connectedOn: null });
    repos.meetings.create(meeting("chronologically-newer", "2026-07-20T10:00:00-07:00"));
    repos.meetings.create(meeting("lexically-newer", "2026-07-20T18:00:00+02:00"));
    repos.meetingParticipants.create({ id: "participant-1", meetingId: "chronologically-newer", personId: "person-1" });
    repos.meetingParticipants.create({ id: "participant-2", meetingId: "lexically-newer", personId: "person-1" });

    expect(app.meetings.query({})).toMatchObject({
      status: "ok",
      items: [{ id: "chronologically-newer" }, { id: "lexically-newer" }],
    });
    expect(app.meetings.query({
      startsFrom: "2026-07-20T16:30:00Z",
      startsThrough: "2026-07-20T17:00:00Z",
    })).toMatchObject({ status: "ok", items: [{ id: "chronologically-newer" }] });
    expect(() => app.meetings.query({ startsFrom: "not-a-date" }))
      .toThrow("startsFrom must be a valid ISO 8601 timestamp");
  });

  test("meeting reads expose stored consistency failures", () => {
    const { app, repos } = application();
    repos.meetings.create(meeting("no-participants", "2026-07-20T10:00:00-07:00"));
    expect(app.meetings.read("no-participants")).toMatchObject({
      status: "consistency_error",
      message: expect.stringContaining("no participants"),
    });

    repos.meetings.create(meeting("bad-status", "2026-07-21T10:00:00-07:00", { status: "tentative" }));
    repos.meetingParticipants.create({ id: "bad-status::missing", meetingId: "bad-status", personId: "missing" });
    expect(app.meetings.read("bad-status")).toMatchObject({
      status: "consistency_error",
      message: expect.stringContaining("unsupported status"),
    });
  });
});
