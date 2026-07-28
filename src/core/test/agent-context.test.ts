import { describe, expect, test } from "bun:test";
import {
  ApplicationAgentDocumentSource,
  JobSearchAgentContext,
  agentDocumentContentLimit,
  type AgentContextSources,
} from "../src/agent-context";
import type { Job } from "../src/jobs";
import type { NetworkContact } from "../src/network";
import type { TaskRecord } from "../src/tasks";

const job = (id: string, patch: Partial<Job> = {}): Job => ({
  id,
  company: `Company ${id}`,
  title: `Role ${id}`,
  jobId: null,
  roleDirectory: null,
  stage: "applied",
  outcome: "pending",
  statusSummary: "Application active",
  lastActivity: "2026-07-20",
  nextAction: { description: "Follow up", due: "2026-07-23" },
  fit: { rating: "good", summary: null },
  payRange: null,
  sourceUrl: null,
  tags: [],
  hasJobDescription: false,
  hasInterviewPrep: false,
  location: "Seattle",
  workArrangement: "hybrid",
  postedDate: null,
  businessUnitTeam: null,
  recruiterSource: null,
  bonus: null,
  equity: null,
  otherCompensation: null,
  ...patch,
});

const contact = (
  id: string,
  patch: Partial<NetworkContact> = {},
): NetworkContact => ({
  id,
  name: `Person ${id}`,
  company: "Example",
  title: "Director",
  linkedInProfileUrl: null,
  profileStatus: "missing",
  connectedOn: null,
  relationship: {
    type: "former_colleague",
    strength: "warm",
    introducedBy: null,
    notes: null,
  },
  priority: "medium",
  status: "active_relationship",
  outreach: {
    lastContacted: null,
    lastContactMethod: null,
    lastContactSummary: null,
    nextAction: "Reconnect",
    nextActionDue: "2026-07-23",
  },
  whyInteresting: "Relevant leader",
  notes: [],
  tags: [],
  source: { files: [] },
  createdAt: "2026-07-01",
  updatedAt: "2026-07-20",
  ...patch,
});

const task = (id: string, patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id,
  title: `Task ${id}`,
  type: "application",
  status: "open",
  priority: "medium",
  dueDate: "2026-07-23",
  relatedEntity: { type: "job", id: "job-1", label: "Example role" },
  notes: "Private task notes",
  createdAt: "2026-07-01",
  updatedAt: "2026-07-20",
  completedAt: null,
  ...patch,
});

function reader(
  jobs: Job[] = [],
  contacts: NetworkContact[] = [],
  tasks: TaskRecord[] = [],
) {
  const source = <T extends { id: string }>(records: T[]) => ({
    list: () => records,
    get: (id: string) => records.find((record) => record.id === id) ?? null,
  });
  const sources: AgentContextSources = {
    jobs: source(jobs),
    networking: source(contacts),
    tasks: source(tasks),
  };
  return new JobSearchAgentContext(sources, () => "2026-07-24");
}

describe("JobSearchAgentContext", () => {
  test("applies job defaults, multi-value filters, ordering, and pagination", () => {
    const context = reader([
      job("screen", { stage: "screening", fit: { rating: "strong", summary: null } }),
      job("closed", { stage: "closed", outcome: "rejected", nextAction: null }),
      job("applied-overdue", { nextAction: { description: "Email recruiter", due: "2026-07-22" } }),
      job("applied-future", { nextAction: { description: "Prepare", due: "2026-07-25" } }),
    ]);

    expect(context.listJobs({}).items.map(({ id }) => id)).toEqual([
      "applied-overdue",
      "screen",
      "applied-future",
    ]);
    expect(context.listJobs({
      overdueOnly: false,
      offset: 0,
      limit: 20,
    }).items.map(({ id }) => id)).toEqual([
      "applied-overdue",
      "screen",
      "applied-future",
    ]);
    expect(context.listJobs({
      stages: ["applied"],
      fitRatings: ["good"],
      offset: 0,
      limit: 1,
    })).toMatchObject({
      items: [{ id: "applied-overdue" }],
      page: { returned: 1, total: 2, hasMore: true, nextOffset: 1 },
    });
  });

  test("broadens curated defaults when another job filter is supplied", () => {
    const context = reader([
      job("active"),
      job("rejected", { stage: "closed", outcome: "rejected", nextAction: null }),
    ]);
    expect(context.listJobs({}).items.map(({ id }) => id)).toEqual(["active"]);
    expect(context.listJobs({ outcomes: ["rejected"] }).items.map(({ id }) => id)).toEqual([
      "rejected",
    ]);
    expect(context.listJobs({ query: "rejected" }).items.map(({ id }) => id)).toEqual([
      "rejected",
    ]);
  });

  test("filters contacts with inclusion arrays", () => {
    const context = reader([], [
      contact("active-high", { priority: "high" }),
      contact("due", { status: "follow_up_due", priority: "high" }),
      contact("paused", { status: "paused" }),
    ]);

    expect(context.listNetworkingContacts({}).items.map(({ id }) => id)).toEqual(["active-high"]);
    expect(context.listNetworkingContacts({
      statuses: ["active_relationship", "follow_up_due"],
      priorities: ["high", "medium"],
    }).items.map(({ id }) => id)).toEqual(["active-high", "due"]);
    expect(context.listNetworkingContacts({ overdueOnly: true }).items.map(({ id }) => id)).toEqual([
      "active-high",
      "due",
    ]);
  });

  test("filters tasks and returns searchable notes", () => {
    const context = reader([], [], [
      task("open-overdue", { dueDate: "2026-07-22", priority: "high" }),
      task("progress", { status: "in_progress", type: "networking_follow_up" }),
      task("completed", { status: "completed", completedAt: "2026-07-20" }),
    ]);

    const result = context.listTasks({
      statuses: ["open", "in_progress"],
      types: ["application", "networking_follow_up"],
    });
    expect(result.items.map(({ id }) => id)).toEqual(["open-overdue", "progress"]);
    expect(result.items[0]?.notes).toBe("Private task notes");
    expect(context.listTasks({ query: "private task" }).items).toHaveLength(3);
  });

  test("returns allowlisted detail records and misses", async () => {
    const context = reader([job("job-1")], [contact("contact-1")], [task("task-1")]);
    const jobResult = await context.getJob("job-1");
    expect(jobResult).toMatchObject({ status: "ok", record: { id: "job-1", documents: [] } });
    expect(jobResult.status === "ok" ? jobResult.record : {}).not.toHaveProperty("roleDirectory");
    expect(await context.getNetworkingContact("missing")).toEqual({ status: "not_found", id: "missing" });
    expect(await context.getTask("task-1")).toMatchObject({
      status: "ok",
      record: { id: "task-1", notes: "Private task notes", documents: [] },
    });
  });

  test("lists stable document references and resolves only registered documents", async () => {
    let ownerVisible = true;
    const managedDocument = {
      id: "doc_00000000-0000-4000-8000-000000000001",
      reference: "document:doc_00000000-0000-4000-8000-000000000001",
      ownerType: "job" as const,
      ownerId: "job-1",
      documentType: "notes" as const,
      title: "Role notes",
      mediaType: "text/markdown" as const,
      sourceDescription: null,
      currentVersion: 2,
      content: "Current notes",
      contentHash: "hash-v2",
      createdAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-21T12:00:00.000Z",
    };
    const documentSource = new ApplicationAgentDocumentSource({
      jobs: {
        get: (id) => ownerVisible && id === "job-1"
          ? job("job-1", { hasJobDescription: true, hasInterviewPrep: true })
          : null,
        description: async () => "Job description content",
        prep: async () => [{ name: "screen.md", content: "Interview notes" }],
      },
      people: {
        get: (id) => id === "person-1" ? { hasLocalProfile: true } : null,
        profile: async (id) => id === "person-1" ? "" : null,
      },
      contacts: {
        personId: (id) => id === "contact-1" ? "person-1" : null,
      },
      managed: {
        get: (reference) =>
          reference === managedDocument.reference ? managedDocument : null,
        list: (ownerType, ownerId) =>
          ownerType === "job" && ownerId === "job-1"
            ? [managedDocument]
            : [],
      },
    });
    const source = <T extends { id: string }>(records: T[]) => ({
      list: () => records,
      get: (id: string) => records.find((record) => record.id === id) ?? null,
    });
    const context = new JobSearchAgentContext({
      jobs: source([job("job-1", { hasJobDescription: true, hasInterviewPrep: true })]),
      networking: source([contact("contact-1", { hasLocalProfile: true })]),
      tasks: source([]),
      documents: documentSource,
    });
    const detail = await context.getJob("job-1");
    expect(detail.status === "ok" ? detail.record.documents : []).toEqual([
      expect.objectContaining({
        reference: "job:job-1:job_description",
        title: "Job description",
      }),
      expect.objectContaining({
        reference: "job:job-1:interview_prep:screen.md",
        title: "screen.md",
      }),
      expect.objectContaining({
        reference: managedDocument.reference,
        storage: "managed",
        currentVersion: 2,
      }),
    ]);
    expect(await context.getDocument("job:job-1:interview_prep:screen.md")).toMatchObject({
      status: "ok",
      record: {
        content: "Interview notes",
        truncated: false,
        totalCharacters: 15,
      },
    });
    expect(await context.getDocument("contact:contact-1:contact_profile")).toMatchObject({
      status: "ok",
      record: { entityId: "contact-1", content: "", totalCharacters: 0 },
    });
    expect(await context.getDocument("job:job-1:interview_prep:missing.md")).toEqual({
      status: "not_found",
      id: "job:job-1:interview_prep:missing.md",
    });
    expect(await context.getDocument(managedDocument.reference)).toMatchObject({
      status: "ok",
      record: {
        content: "Current notes",
        storage: "managed",
        currentVersion: 2,
      },
    });
    ownerVisible = false;
    expect(await context.getDocument(managedDocument.reference)).toEqual({
      status: "not_found",
      id: managedDocument.reference,
    });
  });

  test("bounds document content returned to the agent", async () => {
    const content = "x".repeat(agentDocumentContentLimit + 10);
    const documentSource = new ApplicationAgentDocumentSource({
      jobs: {
        get: (id) => id === "job-1"
          ? job("job-1", { hasJobDescription: true })
          : null,
        description: async () => content,
        prep: async () => [],
      },
      people: {
        get: () => null,
        profile: async () => null,
      },
      contacts: {
        personId: () => null,
      },
    });
    expect(await documentSource.get("job:job-1:job_description")).toMatchObject({
      status: "ok",
      record: {
        content: "x".repeat(agentDocumentContentLimit),
        truncated: true,
        totalCharacters: agentDocumentContentLimit + 10,
      },
    });
  });
});
