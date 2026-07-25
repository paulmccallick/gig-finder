import { describe, expect, test } from "bun:test";
import {
  JobSearchAgentContext,
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
  outcome: null,
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
  test("applies job defaults, multi-value filters, exclusions, ordering, and pagination", () => {
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
      stages: ["applied", "screening", "closed"],
      excludeStages: ["closed"],
      fitRatings: ["strong", "good"],
      excludeFitRatings: ["strong"],
      offset: 0,
      limit: 1,
    })).toMatchObject({
      items: [{ id: "applied-overdue" }],
      page: { returned: 1, total: 2, hasMore: true, nextOffset: 1 },
    });
  });

  test("filters contacts with inclusion and exclusion arrays", () => {
    const context = reader([], [
      contact("active-high", { priority: "high" }),
      contact("due", { status: "follow_up_due", priority: "high" }),
      contact("paused", { status: "paused" }),
    ]);

    expect(context.listNetworkingContacts({}).items.map(({ id }) => id)).toEqual(["active-high"]);
    expect(context.listNetworkingContacts({
      statuses: ["active_relationship", "follow_up_due", "paused"],
      excludeStatuses: ["paused"],
      priorities: ["high", "medium"],
    }).items.map(({ id }) => id)).toEqual(["active-high", "due"]);
  });

  test("filters tasks and omits private notes from summaries", () => {
    const context = reader([], [], [
      task("open-overdue", { dueDate: "2026-07-22", priority: "high" }),
      task("progress", { status: "in_progress", type: "networking_follow_up" }),
      task("completed", { status: "completed", completedAt: "2026-07-20" }),
    ]);

    const result = context.listTasks({
      statuses: ["open", "in_progress", "completed"],
      excludeStatuses: ["completed"],
      types: ["application", "networking_follow_up"],
    });
    expect(result.items.map(({ id }) => id)).toEqual(["open-overdue", "progress"]);
    expect(result.items[0]).not.toHaveProperty("notes");
  });

  test("returns discriminated get results for current records and misses", () => {
    const context = reader([job("job-1")], [contact("contact-1")], [task("task-1")]);
    expect(context.getJob("job-1")).toMatchObject({ status: "ok", record: { id: "job-1" } });
    expect(context.getNetworkingContact("missing")).toEqual({ status: "not_found", id: "missing" });
    expect(context.getTask("task-1")).toMatchObject({ status: "ok", record: { id: "task-1" } });
  });
});
