import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { writeEncodedDescriptionSelectionReport } from "./scout-encoded-description-selection";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root =>
    rm(root, { recursive: true, force: true })
  ));
});

async function temporaryRoot(prefix: string) {
  const temporaryDirectory = path.join(repositoryRoot, "tmp");
  await mkdir(temporaryDirectory, { recursive: true });
  const root = await mkdtemp(path.join(temporaryDirectory, prefix));
  temporaryRoots.push(root);
  return root;
}

function createSelectionDatabase(databasePath: string) {
  const database = new Database(databasePath, { create: true, strict: true });
  database.exec(`
    CREATE TABLE scout_companies(id text PRIMARY KEY,name text NOT NULL);
    CREATE TABLE scout_positions(id text PRIMARY KEY,company_id text NOT NULL);
    CREATE TABLE scout_position_states(position_id text PRIMARY KEY,state text NOT NULL,linked_gig_id text,current_decision_id text);
    CREATE TABLE scout_position_decisions(id text PRIMARY KEY,origin text NOT NULL);
    CREATE TABLE scout_description_artifacts(id text PRIMARY KEY,file_path text NOT NULL);
    CREATE TABLE scout_position_descriptions(id text PRIMARY KEY,position_id text NOT NULL,artifact_id text NOT NULL,created_at text NOT NULL);
    CREATE TABLE scout_position_promotions(position_id text PRIMARY KEY,gig_id text,status text NOT NULL);
    INSERT INTO scout_companies VALUES('company-1','Example Company');
  `);
  return database;
}

function createSymlinkTestDatabase(
  databasePath: string,
  artifacts: Array<{
    positionId: string;
    artifactId: string;
    filePath: string;
  }>,
) {
  const database = createSelectionDatabase(databasePath);
  const insertPosition = database.query(
    "INSERT INTO scout_positions VALUES(?,'company-1')",
  );
  const insertState = database.query(
    "INSERT INTO scout_position_states VALUES(?,'needs_user_review',NULL,NULL)",
  );
  const insertArtifact = database.query(
    "INSERT INTO scout_description_artifacts VALUES(?,?)",
  );
  const insertDescription = database.query(
    "INSERT INTO scout_position_descriptions VALUES(?,?,?,'2026-08-30T12:00:00Z')",
  );
  for (const artifact of artifacts) {
    insertPosition.run(artifact.positionId);
    insertState.run(artifact.positionId);
    insertArtifact.run(artifact.artifactId, artifact.filePath);
    insertDescription.run(
      `description-${artifact.artifactId}`,
      artifact.positionId,
      artifact.artifactId,
    );
  }
  database.close();
}

test("selects only reviewable, agent-irrelevant, and completed promoted encoded descriptions", async () => {
  const root = await temporaryRoot("encoded-selection-test-");
  const descriptions = path.join(root, "descriptions");
  await mkdir(descriptions);
  const databasePath = path.join(root, "selection.sqlite");
  const outputPath = path.join(root, "selection.json");
  const database = createSelectionDatabase(databasePath);

  const positions = {
    review: `spos_${"1".repeat(32)}`,
    agentIrrelevant: `spos_${"2".repeat(32)}`,
    promoted: `spos_${"3".repeat(32)}`,
    userIrrelevant: `spos_${"4".repeat(32)}`,
    clean: `spos_${"5".repeat(32)}`,
    missing: `spos_${"6".repeat(32)}`,
    userRejected: `spos_${"7".repeat(32)}`,
    unreadable: `spos_${"8".repeat(32)}`,
  };
  const files: Record<keyof typeof positions, string> = {
    review: "review.md",
    agentIrrelevant: "agent-irrelevant.md",
    promoted: "promoted.md",
    userIrrelevant: "user-irrelevant.md",
    clean: "clean.md",
    missing: "missing.md",
    userRejected: "user-rejected.md",
    unreadable: "unreadable.md",
  };
  const contents: Partial<Record<keyof typeof positions, string>> = {
    review: "Private review content &lt;div class=&quot;role&quot;&gt;hidden&lt;/div&gt;",
    agentIrrelevant: "Private agent prose &LT;P&gt;hidden&LT;/P&gt;",
    promoted: "Private promoted prose &amp;lt;ul&amp;gt;&amp;lt;li&amp;gt;hidden&amp;lt;/li&amp;gt;&amp;lt;/ul&amp;gt;",
    userIrrelevant: "Private user decision &lt;strong&gt;hidden&lt;/strong&gt;",
    clean: "# Clean description\n\nNo encoded structure.",
    userRejected: "Private rejected prose &lt;em&gt;hidden&lt;/em&gt;",
  };
  const supersededContent = "Private superseded prose &lt;h2&gt;hidden&lt;/h2&gt;";
  for (const [name, content] of Object.entries(contents)) {
    await writeFile(
      path.join(descriptions, files[name as keyof typeof positions]),
      content,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  await writeFile(
    path.join(descriptions, "superseded-clean.md"),
    supersededContent,
    { encoding: "utf8", mode: 0o600 },
  );
  await mkdir(path.join(descriptions, files.unreadable));

  const insertPosition = database.query(
    "INSERT INTO scout_positions VALUES(?,'company-1')",
  );
  const insertState = database.query(
    "INSERT INTO scout_position_states VALUES(?,?,?,?)",
  );
  const insertArtifact = database.query(
    "INSERT INTO scout_description_artifacts VALUES(?,?)",
  );
  const insertDescription = database.query(
    "INSERT INTO scout_position_descriptions VALUES(?,?,?,?)",
  );
  database.query(`
    INSERT INTO scout_position_decisions VALUES
      ('decision-agent','agent'),
      ('decision-user-irrelevant','user'),
      ('decision-user-promoted','user'),
      ('decision-user-rejected','user')
  `).run();
  for (const [name, positionId] of Object.entries(positions)) {
    insertPosition.run(positionId);
    const artifactId = `artifact-${name}`;
    insertArtifact.run(artifactId, files[name as keyof typeof positions]);
    insertDescription.run(
      `description-${name}`,
      positionId,
      artifactId,
      "2026-08-29T12:00:00Z",
    );
  }
  insertArtifact.run("artifact-clean-superseded", "superseded-clean.md");
  insertDescription.run(
    "description-clean-superseded",
    positions.clean,
    "artifact-clean-superseded",
    "2026-08-28T12:00:00Z",
  );
  insertState.run(positions.review, "needs_user_review", null, null);
  insertState.run(
    positions.agentIrrelevant,
    "irrelevant",
    null,
    "decision-agent",
  );
  insertState.run(
    positions.promoted,
    "promoted",
    "gig_exact_promoted",
    "decision-user-promoted",
  );
  insertState.run(
    positions.userIrrelevant,
    "irrelevant",
    null,
    "decision-user-irrelevant",
  );
  insertState.run(positions.clean, "needs_user_review", null, null);
  insertState.run(positions.missing, "needs_user_review", null, null);
  insertState.run(
    positions.userRejected,
    "rejected",
    null,
    "decision-user-rejected",
  );
  insertState.run(positions.unreadable, "needs_user_review", null, null);
  database.query(
    "INSERT INTO scout_position_promotions VALUES(?,?,'completed')",
  ).run(positions.promoted, "gig_exact_promoted");
  database.close();

  const report = await writeEncodedDescriptionSelectionReport({
    databasePath,
    descriptionsPath: descriptions,
    outputPath,
    generatedAt: "2026-08-30T12:00:00.000Z",
  });
  expect(report).toEqual({
    generatedAt: "2026-08-30T12:00:00.000Z",
    complete: false,
    selected: [
      {
        positionId: positions.review,
        state: "needs_user_review",
        origin: null,
        linkedGigId: null,
        company: "Example Company",
      },
      {
        positionId: positions.agentIrrelevant,
        state: "irrelevant",
        origin: "agent",
        linkedGigId: null,
        company: "Example Company",
      },
      {
        positionId: positions.promoted,
        state: "promoted",
        origin: "user",
        linkedGigId: "gig_exact_promoted",
        company: "Example Company",
      },
    ],
    excluded: {
      encoded_tag_not_found: 1,
      ineligible_state_or_origin: 2,
    },
    unresolved: [
      { positionId: positions.missing, code: "missing_artifact" },
      { positionId: positions.unreadable, code: "unreadable_artifact" },
    ],
  });
  const serialized = await readFile(outputPath, "utf8");
  expect(JSON.parse(serialized)).toEqual(report);
  const privateValues = [
    ...Object.values(contents),
    supersededContent,
    ...Object.values(files),
    "superseded-clean.md",
    descriptions,
  ];
  for (const privateValue of privateValues) {
    expect(serialized).not.toContain(privateValue);
  }
  expect(Object.keys(JSON.parse(serialized))).toEqual([
    "generatedAt",
    "complete",
    "selected",
    "excluded",
    "unresolved",
  ]);
});

test("rejects artifact symlink components and final files without reading their targets", async () => {
  const root = await temporaryRoot("encoded-selection-input-symlink-");
  const descriptions = path.join(root, "descriptions");
  const outside = path.join(root, "outside-descriptions");
  await mkdir(descriptions);
  await mkdir(outside);
  const outsideContent = "Outside fixture content &lt;div&gt;must not be read&lt;/div&gt;";
  await writeFile(path.join(outside, "secret.md"), outsideContent, "utf8");
  await symlink(
    path.join(outside, "secret.md"),
    path.join(descriptions, "final-link.md"),
  );
  await symlink(outside, path.join(descriptions, "component-link"));

  const finalLinkPosition = `spos_${"a".repeat(32)}`;
  const componentLinkPosition = `spos_${"b".repeat(32)}`;
  const databasePath = path.join(root, "selection.sqlite");
  createSymlinkTestDatabase(databasePath, [
    {
      positionId: finalLinkPosition,
      artifactId: "artifact-final-link",
      filePath: "final-link.md",
    },
    {
      positionId: componentLinkPosition,
      artifactId: "artifact-component-link",
      filePath: "component-link/secret.md",
    },
  ]);

  const outputPath = path.join(root, "selection.json");
  const report = await writeEncodedDescriptionSelectionReport({
    databasePath,
    descriptionsPath: descriptions,
    outputPath,
    generatedAt: "2026-08-30T12:00:00.000Z",
  });

  expect(report.selected).toEqual([]);
  expect(report.unresolved).toEqual([
    { positionId: finalLinkPosition, code: "unreadable_artifact" },
    { positionId: componentLinkPosition, code: "unreadable_artifact" },
  ]);
  expect(await readFile(path.join(outside, "secret.md"), "utf8"))
    .toBe(outsideContent);
});

test("rejects output symlink components and final files without writing their targets", async () => {
  const root = await temporaryRoot("encoded-selection-output-symlink-");
  const descriptions = path.join(root, "descriptions");
  const outside = path.join(root, "outside-output");
  await mkdir(descriptions);
  await mkdir(outside);
  await writeFile(
    path.join(descriptions, "clean.md"),
    "# Clean description",
    "utf8",
  );
  const databasePath = path.join(root, "selection.sqlite");
  createSymlinkTestDatabase(databasePath, [{
    positionId: `spos_${"c".repeat(32)}`,
    artifactId: "artifact-clean",
    filePath: "clean.md",
  }]);

  const sentinelPath = path.join(outside, "sentinel.json");
  const sentinel = "outside sentinel must remain unchanged";
  await writeFile(sentinelPath, sentinel, "utf8");
  const finalLink = path.join(root, "final-output-link.json");
  await symlink(sentinelPath, finalLink);
  await expect(writeEncodedDescriptionSelectionReport({
    databasePath,
    descriptionsPath: descriptions,
    outputPath: finalLink,
  })).rejects.toThrow("must not contain symbolic links");
  expect(await readFile(sentinelPath, "utf8")).toBe(sentinel);

  const linkedParent = path.join(root, "linked-output-parent");
  await symlink(outside, linkedParent);
  const escapedOutput = path.join(linkedParent, "escaped.json");
  await expect(writeEncodedDescriptionSelectionReport({
    databasePath,
    descriptionsPath: descriptions,
    outputPath: escapedOutput,
  })).rejects.toThrow("must not contain symbolic links");
  expect(await Bun.file(path.join(outside, "escaped.json")).exists()).toBe(false);
});
