import { describe, expect, test } from "bun:test";
import { GigFinderApplication } from "../application";
import type {
  ArtifactPort,
  ArtifactVerification,
  AuditPort,
  DocumentWriteRepository,
  Persistence,
  ReadRepository,
  UnitOfWork,
} from "../ports";
import type {
  ChangeContext,
  EntityRecord,
  GigData,
  GigPersonData,
  InteractionData,
  InteractionParticipantData,
  PersonData,
  TaskData,
} from "../models";
import type {
  DocumentLinkEntityType,
  ManagedDocumentData,
  ManagedDocumentRecord,
  ManagedDocumentVersionData,
} from "../documents";

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
  touch(id: string, revision: number) { return this.update(id, revision, {}); }
  delete(id: string) { return this.rows.get(id)!; }
  restore(id: string) { return this.rows.get(id)!; }
}

class EmptyDocuments implements DocumentWriteRepository {
  get() { return null; }
  createdByChange() { return null; }
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
const personData = (identity: Pick<PersonData, "id" | "name" | "company" | "title" | "linkedInProfileUrl" | "connectedOn">, overrides: Partial<PersonData> = {}): PersonData => ({
  ...identity,
  relationshipType: "professional_contact",
  relationshipStrength: "unknown",
  introducedBy: null,
  relationshipNotes: null,
  priority: "unranked",
  status: "not_contacted",
  whyInteresting: null,
  notesJson: "[]",
  tagsJson: "[]",
  ...overrides,
});

function application() {
  const gigs = new Repo<GigData>();
  const people = new Repo<PersonData>();
  const gigPeople = new Repo<GigPersonData>();
  const tasks = new Repo<TaskData>();
  const interactions = new Repo<InteractionData>();
  const interactionParticipants = new Repo<InteractionParticipantData>();
  const documents = new EmptyDocuments();
  const settings = { get: () => null, set: () => undefined };
  let readChanges = 0;
  const persistence: Persistence = {
    gigs,
    people,
    gigPeople,
    tasks,
    interactions,
    interactionParticipants,
    documents,
    settings,
    hasChange: () => false,
    creationFingerprint:()=>null,
    change: (changeContext, action) => {
      readChanges += 1;
      return {
        changeId: changeContext.changeId ?? "change",
        value: action({
          gigs,
          people,
          gigPeople,
          tasks,
          interactions,
          interactionParticipants,
          documents,
          recordCreationFingerprint:()=>undefined,
        } as UnitOfWork),
      };
    },
    revertChange: () => ({ changeId: "revert", value: [] }),
  };
  return {
    app: new GigFinderApplication(persistence, audit, artifacts),
    repos: { gigs, people, gigPeople, tasks, interactions, interactionParticipants },
    changes: () => readChanges,
  };
}

const gig = (id: string, company: string, stage: GigData["stage"] = "applied"): GigData => ({
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

const interaction = (
  id: string,
  startsAt: string,
  overrides: Partial<InteractionData> = {},
): InteractionData => ({
  id,
  subject: "Interview",
  kind: "interview",
  channel: "video",
  direction: "mutual",
  startsAt,
  endsAt: startsAt,
  timezone: "America/Los_Angeles",
  location: "Video",
  summary: "Platform conversation",
  notes: null,
  status: "confirmed",
  gigId: null,
  supersedesInteractionId: null,
  originChangeId: null,
  structuredDataJson: "{}",
  ...overrides,
});

describe("caller-neutral read services", () => {
  test("gigs and tasks apply defaults, pagination, and list/get field parity", () => {
    const { app, repos, changes } = application();
    repos.gigs.create(gig("gig-b", "Beta"));
    repos.gigs.create(gig("gig-a", "Alpha", "identified"));
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
    expect(app.gigs.query({}).items.map(record => record.id)).toEqual(["gig-b"]);
    const all = app.gigs.query({ query: "Alpha", offset: 0, limit: 1 });
    const readGig = app.gigs.read("gig-a");
    expect(all).toMatchObject({ page: { returned: 1, total: 1, hasMore: false } });
    expect(Object.keys(all.items[0]!).sort()).toEqual(
      Object.keys(readGig.status === "ok" ? readGig.record : {}).sort(),
    );
    const tasks = app.tasks.query({});
    const readTask = app.tasks.read("task-1");
    expect(tasks.items).toHaveLength(1);
    expect(readTask.status).toBe("ok");
    if (readTask.status !== "ok") throw new Error("Expected task read to succeed");
    expect(tasks.items[0]).toEqual(readTask.record);
    expect(() => app.gigs.query({ limit: 51 })).toThrow("Page limit must be an integer from 1 to 50.");
    expect(changes()).toBe(before);
  });

  test("people search and updates use one unified record", () => {
    const { app, repos } = application();
    repos.people.create(personData({ id: "person-standalone", name: "Standalone Person", company: "Acme", title: "CTO", linkedInProfileUrl: null, connectedOn: null }));
    repos.people.create(personData({ id: "person-contact", name: "Contact Person", company: "Beta", title: "Recruiter", linkedInProfileUrl: null, connectedOn: null }, { relationshipType: "recruiter", relationshipStrength: "warm", priority: "high", status: "active_relationship" }));
    expect(app.people.query({ query: "acme" }).items.map(person => person.id)).toEqual(["person-standalone"]);
    const contactRead = app.people.read("person-contact");
    expect(contactRead).toMatchObject({ status: "ok", record: { id: "person-contact", status: "active_relationship" } });
    const listedPerson = app.people.query({ query: "Standalone" }).items[0]!;
    const readPerson = app.people.read("person-standalone");
    expect(readPerson.status).toBe("ok");
    if (readPerson.status !== "ok") throw new Error("Expected person read to succeed");
    expect(Object.keys(listedPerson).sort()).toEqual(Object.keys(readPerson.record).sort());
    const listedContact = app.people.query({ statuses: ["active_relationship"] }).items[0]!;
    if (contactRead.status !== "ok") throw new Error("Expected contact read to succeed");
    expect(Object.keys(listedContact).sort()).toEqual(Object.keys(contactRead.record).sort());
    app.people.update(context, "person-contact", { status: "follow_up_due" });
    expect(repos.people.get("person-contact")?.status).toBe("follow_up_due");
  });

  test("relationships support multi-value filters and both traversal directions", () => {
    const { app, repos } = application();
    repos.gigs.create(gig("gig-1", "Alpha"));
    repos.gigs.create(gig("gig-2", "Beta"));
    repos.people.create(personData({ id: "person-1", name: "Alex", company: "Alpha", title: "VP", linkedInProfileUrl: null, connectedOn: null }));
    repos.people.create(personData({ id: "person-2", name: "Blair", company: "Beta", title: "Recruiter", linkedInProfileUrl: null, connectedOn: null }));
    repos.gigPeople.create({ id: "rel-1", gigId: "gig-1", personId: "person-1", relationship: "hiring_manager", notes: null });
    repos.gigPeople.create({ id: "rel-2", gigId: "gig-1", personId: "person-2", relationship: "recruiter", notes: null });
    repos.gigPeople.create({ id: "rel-3", gigId: "gig-2", personId: "person-1", relationship: "former_peer", notes: null });
    repos.gigPeople.create({ id: "rel-4", gigId: "gig-2", personId: "person-2", relationship: "professional_contact", notes: null });
    const relationships = app.gigPeople.query({
      gigIds: ["gig-1", "gig-2"],
      personIds: ["person-1"],
      relationships: ["hiring_manager", "former_peer"],
    });
    expect(relationships).toMatchObject({ status: "ok", items: [{ id: "rel-1" }, { id: "rel-3" }] });
    const readRelationship = app.gigPeople.read("rel-1");
    expect(readRelationship.status).toBe("ok");
    expect(app.gigPeople.read("rel-4")).toMatchObject({
      status: "ok",
      record: { relationship: "professional_contact" },
    });
    if (relationships.status !== "ok" || readRelationship.status !== "ok") {
      throw new Error("Expected relationship reads to succeed");
    }
    expect(Object.keys(relationships.items[0]!).sort())
      .toEqual(Object.keys(readRelationship.record).sort());
    expect(app.gigPeople.peopleForGig("gig-1")).toMatchObject({
      status: "ok",
      record: { items: [{ id: "person-1" }, { id: "person-2" }] },
    });
    expect(app.gigPeople.gigsForPerson("person-1")).toMatchObject({
      status: "ok",
      record: { items: [{ id: "gig-1" }, { id: "gig-2" }] },
    });
  });

  test("relationship reads distinguish missing records from broken stored links", () => {
    const { app, repos } = application();
    expect(app.gigPeople.read("missing")).toEqual({ status: "not_found", id: "missing" });
    repos.gigPeople.create({ id: "broken", gigId: "missing-gig", personId: "missing-person", relationship: "recruiter", notes: null });
    expect(app.gigPeople.read("broken")).toMatchObject({
      status: "consistency_error",
      id: "broken",
      message: expect.stringContaining("missing gig"),
    });
    repos.gigPeople.create({ id: "invalid", gigId: "missing-gig", personId: "missing-person", relationship: "friend", notes: null });
    expect(app.gigPeople.query({})).toMatchObject({
      status: "consistency_error",
      id: "invalid",
      message: expect.stringContaining("unsupported relationship"),
    });
  });

  test("Interactions compose every participant and support all filters", () => {
    const { app, repos, changes } = application();
    repos.gigs.create(gig("gig-1", "Alpha"));
    repos.gigs.create(gig("gig-2", "Beta"));
    repos.people.create(personData({ id: "person-1", name: "Alex", company: "Alpha", title: "VP", linkedInProfileUrl: null, connectedOn: null }));
    repos.people.create(personData({ id: "person-2", name: "Blair", company: "Beta", title: "Recruiter", linkedInProfileUrl: null, connectedOn: null }));
    repos.interactions.create(interaction("interaction-old", "2026-07-10T10:00:00-07:00", { gigId: "gig-1",kind:"message",channel:"email",direction:"outbound" }));
    repos.interactions.create(interaction("interaction-new", "2026-07-20T10:00:00-07:00", { subject: "Coffee", status: "completed", gigId: "gig-2", summary: "Leadership discussion" }));
    repos.interactionParticipants.create({ id: "old-person-1", interactionId: "interaction-old", personId: "person-1" });
    repos.interactionParticipants.create({ id: "new-person-1", interactionId: "interaction-new", personId: "person-1" });
    repos.interactionParticipants.create({ id: "new-person-2", interactionId: "interaction-new", personId: "person-2" });
    const before = changes();

    const all = app.interactions.query({});
    expect(all).toMatchObject({ status: "ok", items: [{ id: "interaction-new" }, { id: "interaction-old" }] });
    const filtered = app.interactions.query({
      personIds: ["person-2", "person-missing"],
      gigIds: ["gig-1", "gig-2"],
      statuses: ["completed"],
      kinds:["interview"],channels:["video"],directions:["mutual"],
      startsFrom: "2026-07-20T10:00:00-07:00",
      startsThrough: "2026-07-20T10:00:00-07:00",
      query: "leadership",
      offset: 0,
      limit: 1,
    });
    expect(filtered).toMatchObject({
      status: "ok",
      items: [{ id: "interaction-new", gigId: "gig-2", personIds: ["person-1", "person-2"] }],
      page: { returned: 1, total: 1, hasMore: false },
    });
    const read = app.interactions.read("interaction-new");
    expect(read.status).toBe("ok");
    if (read.status !== "ok" || filtered.status !== "ok") throw new Error("Expected Interaction reads to succeed");
    expect(filtered.items[0]).toEqual(read.record);
    expect(app.interactions.read("missing")).toEqual({ status: "not_found", id: "missing" });
    expect(changes()).toBe(before);
  });

  test("Interaction date filters and ordering compare absolute instants", () => {
    const { app, repos } = application();
    repos.people.create(personData({ id: "person-1", name: "Alex", company: null, title: null, linkedInProfileUrl: null, connectedOn: null }));
    repos.interactions.create(interaction("chronologically-newer", "2026-07-20T10:00:00-07:00"));
    repos.interactions.create(interaction("lexically-newer", "2026-07-20T18:00:00+02:00"));
    repos.interactionParticipants.create({ id: "participant-1", interactionId: "chronologically-newer", personId: "person-1" });
    repos.interactionParticipants.create({ id: "participant-2", interactionId: "lexically-newer", personId: "person-1" });

    expect(app.interactions.query({})).toMatchObject({
      status: "ok",
      items: [{ id: "chronologically-newer" }, { id: "lexically-newer" }],
    });
    expect(app.interactions.query({
      startsFrom: "2026-07-20T16:30:00Z",
      startsThrough: "2026-07-20T17:00:00Z",
    })).toMatchObject({ status: "ok", items: [{ id: "chronologically-newer" }] });
    expect(() => app.interactions.query({ startsFrom: "not-a-date" }))
      .toThrow("Interaction startsFrom must be a valid ISO 8601 timestamp");
  });

  test("Interaction reads expose stored consistency failures", () => {
    const { app, repos } = application();
    repos.interactions.create(interaction("no-participants", "2026-07-20T10:00:00-07:00"));
    expect(app.interactions.read("no-participants")).toMatchObject({
      status: "consistency_error",
      message: expect.stringContaining("expected array to have >=1 items"),
    });

    repos.interactions.create(interaction("bad-status", "2026-07-21T10:00:00-07:00", { status: "tentative" }));
    repos.interactionParticipants.create({ id: "bad-status::missing", interactionId: "bad-status", personId: "missing" });
    expect(app.interactions.read("bad-status")).toMatchObject({
      status: "consistency_error",
      message: expect.stringContaining("Invalid option"),
    });
  });
});
