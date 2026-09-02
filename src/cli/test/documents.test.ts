import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GigData, PersonData } from "../../core/models";
import {
  DataStore,
  migrateDatabase,
  openDatabase,
} from "../../data";

let directory = "";
const executable = path.resolve(import.meta.dir, "../../../bin/gig-finder");

const gig: GigData = {
  id: "gig",
  company: "Example Company",
  title: "Engineering Director",
  externalJobId: null,
  stage: "identified",
  outcome: "pending",
  statusSummary: "Found",
  lastActivity: "2026-07-27",
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
  availability: "unknown",
  availabilityUpdatedAt: null,
};

const person: PersonData = {
  id: "person-1", name: "Jordan Example", company: "Example Company",
  title: "Director", linkedInProfileUrl: null, connectedOn: null,
  relationshipType: "colleague",
  relationshipStrength: "warm", introducedBy: null, relationshipNotes: null,
  priority: "medium", status: "active_relationship",
  whyInteresting: null, notesJson: "[]", tagsJson: "[]",
};

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("managed document CLI", () => {
  test("creates and lists a named Profile context document", async () => {
    const { database, artifacts } = await workspace();
    const contentFile = path.join(directory, "interview-stories.md");
    await Bun.write(contentFile, "# Interview stories\n\nSynthetic example.");

    const created = await run([
      "documents", "create", "--profile",
      "--type", "interview_prep",
      "--title", "Interview stories",
      "--description", "Behavioral examples for interview preparation.",
      "--media-type", "text/markdown",
      "--content-file", contentFile,
    ], database, artifacts);
    const filePath = created.record.filePath as string;

    expect(created.record).toMatchObject({
      links: [{ entityType: "profile", entityId: "candidate" }],
      title: "Interview stories",
      description: "Behavioral examples for interview preparation.",
    });
    expect(filePath).toMatch(/^interview-stories-[0-9a-f]{8}\.md$/);
    expect(await run(
      ["documents", "list", "--profile"],
      database,
      artifacts,
    )).toMatchObject({
      link: { entityType: "profile", entityId: "candidate" },
      records: [{ id: created.record.id, title: "Interview stories" }],
    });
    expect(await readFile(
      path.join(directory, "profile-documents", filePath),
      "utf8",
    )).toBe("# Interview stories\n\nSynthetic example.");
  });

  test("creates a person profile with a friendly fallback and exposes it on linked records", async () => {
    const { database, artifacts } = await workspace();
    const contentFile = path.join(directory, "profile.md");
    await Bun.write(contentFile, "# Profile");

    const created = await run([
      "documents", "create", "--person", person.id, "--gig", gig.id,
      "--type", "profile", "--media-type", "text/markdown",
      "--content-file", contentFile,
    ], database, artifacts);

    expect(created.record).toMatchObject({
      title: null,
      displayName: "Profile",
      links: [
        { entityType: "gig", entityId: gig.id },
        { entityType: "person", entityId: person.id },
      ],
    });
    expect((await run(["gigs", "get", gig.id], database, artifacts)).record.documents)
      .toContainEqual(expect.objectContaining({ id: created.record.id, type: "profile", displayName: "Profile" }));
    expect((await run(["people", "get", person.id], database, artifacts)).record)
      .toMatchObject({ hasProfile: true, documents: [{ id: created.record.id, type: "profile", displayName: "Profile" }] });
  });

  test("creates, lists, and gets a gig document from a content file", async () => {
    const { database, artifacts } = await workspace();
    const contentFile = path.join(directory, "job-description.txt");
    await Bun.write(contentFile, "Original job description");

    const created = await run([
      "documents",
      "create",
      "--gig",
      gig.id,
      "--type",
      "job_description",
      "--title",
      "Job description",
      "--media-type",
      "text/plain",
      "--source-description",
      "Received by text message",
      "--content-file",
      contentFile,
    ], database, artifacts);
    const reference = created.record.id as string;

    expect(created).toMatchObject({
      ok: true,
      entity: "document",
      command: "create",
      changed: true,
      record: {
        id: reference,
        links: [{ entityType: "gig", entityId: gig.id }],
        documentType: "job_description",
        sourceDescription: "Received by text message",
        currentVersion: 1,
        content: "Original job description",
      },
    });
    expect(await run(
      ["documents", "list", "--gig", gig.id],
      database,
      artifacts,
    )).toMatchObject({
      link: { entityType: "gig", entityId: gig.id },
      records: [{ id: reference, currentVersion: 1 }],
    });
    expect(await run(
      ["documents", "get", reference],
      database,
      artifacts,
    )).toMatchObject({
      record: { id: reference, content: "Original job description" },
    });
  });

  test("updates by expected version and preserves version history", async () => {
    const { database, artifacts } = await workspace();
    const contentFile = path.join(directory, "notes.md");
    await Bun.write(contentFile, "# First draft");
    const created = await run([
      "documents",
      "create",
      "--gig",
      gig.id,
      "--type",
      "notes",
      "--title",
      "Role notes",
      "--media-type",
      "text/markdown",
      "--content-file",
      contentFile,
    ], database, artifacts);
    const reference = created.record.id as string;

    await Bun.write(contentFile, "# Revised draft");
    const updated = await run([
      "documents",
      "update",
      reference,
      "--expected-version",
      "1",
      "--change-summary",
      "Revise notes",
      "--content-file",
      contentFile,
    ], database, artifacts);

    expect(updated).toMatchObject({
      changed: true,
      record: {
        id: reference,
        currentVersion: 2,
        content: "# Revised draft",
      },
    });
    expect(await run(
      ["documents", "versions", reference],
      database,
      artifacts,
    )).toMatchObject({
      records: [
        {
          version: 2,
          parentVersion: 1,
          content: "# Revised draft",
          changeSummary: "Revise notes",
        },
        {
          version: 1,
          parentVersion: null,
          content: "# First draft",
        },
      ],
    });

    const unchanged = await run([
      "documents",
      "update",
      reference,
      "--expected-version",
      "2",
      "--change-summary",
      "Repeat notes",
      "--content-file",
      contentFile,
    ], database, artifacts);
    expect(unchanged).toMatchObject({ changed: false, changeId: null });
    expect((await run(
      ["documents", "versions", reference],
      database,
      artifacts,
    )).records).toHaveLength(2);
  });

  test("reports invalid expected versions and stale updates", async () => {
    const { database, artifacts } = await workspace();
    const contentFile = path.join(directory, "notes.md");
    await Bun.write(contentFile, "Initial");
    const created = await run([
      "documents",
      "create",
      "--gig",
      gig.id,
      "--type",
      "notes",
      "--title",
      "Notes",
      "--media-type",
      "text/markdown",
      "--content-file",
      contentFile,
    ], database, artifacts);
    const reference = created.record.id as string;
    await Bun.write(contentFile, "Changed");

    expect((await invoke([
      "documents",
      "update",
      reference,
      "--expected-version",
      "zero",
      "--change-summary",
      "Invalid",
      "--content-file",
      contentFile,
    ], database, artifacts)).stderr).toContain(
      "--expected-version must be a positive integer.",
    );
    expect((await invoke([
      "documents",
      "update",
      reference,
      "--expected-version",
      "2",
      "--change-summary",
      "Stale",
      "--content-file",
      contentFile,
    ], database, artifacts)).stderr).toContain(
      "expected version 2 but is at version 1",
    );
  });

  test("help includes managed documents and artifact synchronization", async () => {
    const child = Bun.spawn([executable, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("documents create");
    expect(stdout).toContain("documents versions");
    expect(stdout).toContain("artifacts sync");
  });
});

async function workspace() {
  directory = await mkdtemp(path.join(tmpdir(), "gig-finder-cli-documents-"));
  const database = path.join(directory, "test.sqlite");
  const artifacts = path.join(directory, "artifacts");
  await mkdir(artifacts);
  const connection = openDatabase(database);
  migrateDatabase(connection);
  new DataStore(connection).change(
    { actor: "test", source: "test", summary: "Seed records" },
    transaction => {
      transaction.gigs.create(gig);
      transaction.people.create(person);
    },
  );
  connection.close();
  return { database, artifacts };
}

async function invoke(args: string[], database: string, artifacts: string) {
  const child = Bun.spawn([executable, ...args], {
    env: {
      ...process.env,
      GIG_FINDER_DATABASE: database,
      GIG_FINDER_ARTIFACTS: artifacts,
      GIG_FINDER_PROFILE_DOCUMENTS: path.join(directory, "profile-documents"),
      GIG_FINDER_ACTOR: "cli-test",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

async function run(args: string[], database: string, artifacts: string) {
  const result = await invoke(args, database, artifacts);
  if (result.code !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}
