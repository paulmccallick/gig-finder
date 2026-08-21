import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  gigFinderMutationToolSchemas,
  gigFinderToolSchemas,
} from "../src/agent/gig-finder-tools";
import { smokeEnvironment as createSmokeEnvironment } from "./smoke-support/environment";
import { openDatabase, migrateDatabase } from "../src/data/database";
import { SqliteScoutRunStore } from "../src/data/scout-run-store";
import { ScoutPositionProcessor } from "../src/core/scout/engine/screening";
import { AiSdkScoutScreeningModel } from "../src/agent/scout-position-screening";
import { createCodexLanguageModel } from "../src/agent/codex-provider";

type Mode = "deterministic" | "live";
type JsonRecord = Record<string, unknown>;

const repositoryRoot = path.resolve(import.meta.dir, "..");
const mode = process.argv[2] as Mode | undefined;
const expectedTools = Object.keys(gigFinderToolSchemas).sort();
const mutationTools = new Set<string>(Object.keys(gigFinderMutationToolSchemas));

const record = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const reason = (value: unknown) => (value instanceof Error ? value.message : String(value))
  .replace(/\s+/g, " ").slice(0, 300);

const smokeEnvironment = (overrides: Record<string, string> = {}) =>
  createSmokeEnvironment(process.env, overrides);

class SmokeFailure extends Error {
  constructor(
    readonly phase: string,
    readonly revision: string,
    readonly correlationId: string,
    message: string,
    readonly tool?: string,
  ) {
    super(message);
  }
}

async function command(
  executable: string,
  args: string[],
  options: { env?: Record<string, string | undefined>; stdout?: "inherit" | "pipe"; stderr?: "inherit" | "pipe" } = {},
) {
  const subprocess = Bun.spawn([executable, ...args], {
    cwd: repositoryRoot,
    env: options.env ?? process.env,
    stdout: options.stdout ?? "pipe",
    stderr: options.stderr ?? "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    subprocess.stdout instanceof ReadableStream ? new Response(subprocess.stdout).text() : Promise.resolve(""),
    subprocess.stderr instanceof ReadableStream ? new Response(subprocess.stderr).text() : Promise.resolve(""),
    subprocess.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${executable} ${args[0] ?? ""} failed: ${reason(stderr || stdout)}`);
  }
  return stdout.trim();
}

const git = (...args: string[]) => command("git", args);

async function revision() {
  const head = await git("rev-parse", "HEAD");
  const requested = Bun.env.SMOKE_REVISION?.trim();
  if (requested && requested !== head) {
    throw new SmokeFailure("revision", head, "startup", `Expected revision ${requested} but checkout is ${head}.`);
  }
  return head;
}

async function requireClean(revision: string) {
  const dirty = await git("status", "--porcelain", "--untracked-files=all");
  if (dirty) {
    throw new SmokeFailure("revision", revision, "startup", "Smoke build requires a clean exact-commit checkout.");
  }
}

const stateRootPath = (runMode: Mode) =>
  path.join(repositoryRoot, "tmp", `smoke-${runMode}-${process.pid}-${crypto.randomUUID()}`);

async function createStateRoot(root: string) {
  for (const directory of ["data", "profile", "profile/documents", "artifacts", "logs", "backups"]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(path.join(root, "config.json"), JSON.stringify({ version: 1, actor: "Synthetic Smoke Candidate" }));
  await copyFile(
    path.join(repositoryRoot, "src/web/test/fixtures/candidate-profile.json"),
    path.join(root, "profile/candidate-profile.json"),
  );
  await writeFile(path.join(root, "upload.md"), "# Synthetic role\n\nSMOKE_DOCUMENT_CONTENT_67\n");
  return root;
}

async function waitForHealth(baseURL: string, expectedRevision: string, correlationId: string, logPath?: string) {
  let last = "not ready";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseURL}/healthz`, { signal: AbortSignal.timeout(1_000) });
      const body = await response.json() as { status?: string; revision?: string };
      if (response.ok && body.status === "ok" && body.revision === expectedRevision) return;
      last = `status ${response.status}, revision ${String(body.revision)}`;
    } catch (error) {
      last = reason(error);
    }
    await Bun.sleep(250);
  }
  if (logPath) {
    try {
      const log = await readFile(logPath, "utf8");
      const latest = log.trim().split("\n").at(-1);
      if (latest) last = reason(latest);
    } catch { /* startup can fail before logging is configured */ }
  }
  throw new SmokeFailure("health-and-migrations", expectedRevision, correlationId, last);
}

function uiEvents(body: string) {
  return body.split("\n").flatMap(line => {
    if (!line.startsWith("data: ") || line === "data: [DONE]") return [];
    try {
      const value: unknown = JSON.parse(line.slice(6));
      return record(value) ? [value] : [];
    } catch {
      return [];
    }
  });
}

let scenarioSequence = 0;
async function sendMessage(
  baseURL: string,
  revision: string,
  conversationId: string,
  text: string,
  phase: string,
  tool?: string,
  timeoutMs = 30_000,
) {
  scenarioSequence += 1;
  const correlationId = `smoke-${mode}-${scenarioSequence}`;
  let response: Response;
  try {
    response = await fetch(`${baseURL}/api/agent/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": correlationId },
      body: JSON.stringify({
        id: conversationId,
        message: { id: `user-${scenarioSequence}`, role: "user", parts: [{ type: "text", text }] },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new SmokeFailure(phase, revision, correlationId, reason(error), tool);
  }
  const body = await response.text();
  if (!response.ok) {
    throw new SmokeFailure(phase, revision, correlationId, `HTTP ${response.status}`, tool);
  }
  const events = uiEvents(body);
  const streamError = events.find(event => event.type === "error");
  if (streamError) {
    throw new SmokeFailure(phase, revision, correlationId, reason(streamError.errorText), tool);
  }
  return { events, correlationId };
}

async function invokeTool(
  baseURL: string,
  revision: string,
  conversationId: string,
  tool: string,
  input: unknown,
) {
  const id = `${scenarioSequence + 1}-${tool.replaceAll("_", "-")}`;
  const encoded = Buffer.from(JSON.stringify(input)).toString("base64url");
  const result = await sendMessage(
    baseURL,
    revision,
    conversationId,
    `SMOKE_TOOL:${id}:${tool}:${encoded}`,
    "tool-operation",
    tool,
  );
  const called = result.events.find(event => event.type === "tool-input-available" && event.toolName === tool);
  const outputEvent = result.events.find(event => event.type === "tool-output-available");
  if (!called || !outputEvent || !record(outputEvent.output)) {
    throw new SmokeFailure("tool-operation", revision, result.correlationId, "Expected tool call and output were not streamed.", tool);
  }
  const output = outputEvent.output;
  if ("status" in output && output.status !== "ok") {
    const detail = typeof output.error === "string"
      ? output.error
      : typeof output.message === "string" ? output.message : String(output.status);
    throw new SmokeFailure("tool-operation", revision, result.correlationId, `Tool returned ${reason(detail)}.`, tool);
  }
  if (mutationTools.has(tool) && typeof output.changeId !== "string") {
    throw new SmokeFailure("audited-mutation", revision, result.correlationId, "Mutation did not return an audit change ID.", tool);
  }
  return output;
}

function outputRecord(output: JsonRecord, tool: string, revision: string): JsonRecord {
  if (!record(output.record)) throw new SmokeFailure("tool-operation", revision, "output", "Tool output did not contain a record.", tool);
  return output.record;
}

async function uploadDocument(baseURL: string, revision: string) {
  const correlationId = `smoke-${mode}-upload`;
  const form = new FormData();
  form.set("file", new File(["# Synthetic role\n\nSMOKE_DOCUMENT_CONTENT_67\n"], "synthetic-role.md", { type: "text/markdown" }));
  const response = await fetch(`${baseURL}/api/agent/documents`, {
    method: "POST",
    headers: { "x-request-id": correlationId },
    body: form,
  });
  const body = await response.json() as unknown;
  if (response.status !== 201 || !record(body) || typeof body.reference !== "string") {
    throw new SmokeFailure("document-upload", revision, correlationId, `Upload returned HTTP ${response.status}.`);
  }
  return body.reference;
}

async function deterministicScenarios(baseURL: string, revision: string) {
  const conversation = "smoke-deterministic-67";
  const page = { offset: null, limit: null };
  await invokeTool(baseURL, revision, conversation, "search_gigs_and_people", { companyNames: [], personNames: [] });
  await invokeTool(baseURL, revision, conversation, "list_gigs", { stages: null, outcomes: null, fitRatings: null, overdueOnly: null, query: null, ...page });
  const createdGig = await invokeTool(baseURL, revision, conversation, "create_gig", {
    company: "Synthetic Systems", title: "Director of Engineering", externalJobId: "smoke-67",
    stage: "identified", outcome: "pending", statusSummary: "Synthetic smoke fixture",
    lastActivity: "2026-08-07", nextAction: null, fit: { rating: "good", summary: "Synthetic fit" },
    payRange: null, sourceUrl: "https://example.invalid/jobs/smoke-67", tags: ["synthetic"],
    location: "Remote", workArrangement: "remote", postedDate: "2026-08-07",
    businessUnitTeam: null, recruiterSource: null, bonus: null, equity: null, otherCompensation: null,
  });
  const gig = outputRecord(createdGig, "create_gig", revision);
  const gigId = String(gig.id);
  await invokeTool(baseURL, revision, conversation, "get_gig", { id: gigId });
  const updatedGig = await invokeTool(baseURL, revision, conversation, "update_gig", {
    id: gigId, changes: [{ operation: "set", field: "stage", value: "applied" }],
  });
  await invokeTool(baseURL, revision, conversation, "revert_change", { changeId: updatedGig.changeId });

  await invokeTool(baseURL, revision, conversation, "list_people", { statuses: null, priorities: null, relationshipStrengths: null, query: null, ...page });
  const createdPerson = await invokeTool(baseURL, revision, conversation, "create_person", {
    name: "Morgan Synthetic", company: "Synthetic Systems", title: "Hiring Lead",
    linkedInProfileUrl: "https://www.linkedin.com/in/synthetic-smoke-67", connectedOn: "2026-08-01",
    relationship: { type: "professional_contact", strength: "warm", introducedBy: null, notes: "Synthetic fixture" },
    priority: "medium", status: "active_relationship", whyInteresting: "Synthetic hiring contact", notes: [], tags: ["synthetic"],
  });
  const person = outputRecord(createdPerson, "create_person", revision);
  const personId = String(person.id);
  await invokeTool(baseURL, revision, conversation, "get_person", { id: personId });
  await invokeTool(baseURL, revision, conversation, "update_person", {
    id: personId, changes: [{ operation: "set", field: "priority", value: "high" }],
  });
  const createdRelationship = await invokeTool(baseURL, revision, conversation, "create_gig_person_relationship", {
    gigId, personId, relationship: "hiring_manager", notes: "Synthetic relationship",
  });
  const relationship = outputRecord(createdRelationship, "create_gig_person_relationship", revision);
  await invokeTool(baseURL, revision, conversation, "list_gig_person_relationships", {
    gigIds: [gigId], personIds: [personId], relationships: null, ...page,
  });
  await invokeTool(baseURL, revision, conversation, "get_gig_person_relationship", { id: relationship.id });

  const createdTask = await invokeTool(baseURL, revision, conversation, "create_task", {
    title: "Synthetic follow-up", type: "networking_follow_up", priority: "medium",
    dueDate: "2026-08-15", relatedEntity: { type: "person", id: personId }, notes: "Synthetic task",
  });
  const task = outputRecord(createdTask, "create_task", revision);
  await invokeTool(baseURL, revision, conversation, "list_tasks", {
    statuses: null, priorities: null, types: null, relatedEntityType: null,
    relatedEntityId: null, overdueOnly: null, query: null, ...page,
  });
  await invokeTool(baseURL, revision, conversation, "get_task", { id: task.id });
  await invokeTool(baseURL, revision, conversation, "update_task", {
    id: task.id, changes: [{ operation: "set", field: "status", value: "in_progress" }],
  });

  const createdInteraction = await invokeTool(baseURL, revision, conversation, "create_interaction", {
    subject: "Synthetic recruiter conversation", kind: "conversation", channel: "video", direction: "mutual",
    startsAt: "2026-08-07T10:00:00-07:00", endsAt: "2026-08-07T10:30:00-07:00",
    timezone: "America/Los_Angeles", status: "completed", personIds: [personId], gigId,
    location: "Remote", summary: "Synthetic smoke interaction", notes: null, supersedesInteractionId: null,
  });
  const interaction = outputRecord(createdInteraction, "create_interaction", revision);
  await invokeTool(baseURL, revision, conversation, "list_interactions", {
    personIds: [personId], gigIds: [gigId], kinds: null, channels: null, directions: null,
    statuses: null, startsFrom: null, startsThrough: null, query: null, ...page,
  });
  await invokeTool(baseURL, revision, conversation, "get_interaction", { id: interaction.id });
  const updatedInteraction = await invokeTool(baseURL, revision, conversation, "update_interaction", {
    id: interaction.id, changes: [{ operation: "set", field: "summary", value: "Updated synthetic summary" }],
  });
  const updatedInteractionRecord = outputRecord(updatedInteraction, "update_interaction", revision);
  await invokeTool(baseURL, revision, conversation, "delete_interaction", {
    id: interaction.id, expectedRevision: updatedInteractionRecord.revision,
  });

  const stagedReference = await uploadDocument(baseURL, revision);
  const createdDocument = await invokeTool(baseURL, revision, conversation, "create_document", {
    links: [{ entityType: "gig", entityId: gigId }], documentType: "job_description",
    title: "Synthetic role", description: null, sourceKind: "staged_document", content: null,
    reference: stagedReference, mediaType: "text/markdown", sourceDescription: "Synthetic smoke upload",
  });
  if (!record(createdDocument.document)) {
    throw new SmokeFailure("document-hydration", revision, "document-output", "Document creation output was incomplete.", "create_document");
  }
  const documentId = String(createdDocument.document.id);
  await invokeTool(baseURL, revision, conversation, "list_documents", { owner: { entityType: "gig", entityId: gigId }, ...page });
  await invokeTool(baseURL, revision, conversation, "list_document_versions", { documentId, ...page });
  await invokeTool(baseURL, revision, conversation, "get_document", { reference: documentId, version: null });
  const editableDocument = await invokeTool(baseURL, revision, conversation, "create_document", {
    links: [{ entityType: "gig", entityId: gigId }], documentType: "notes",
    title: "Synthetic editable notes", description: null, sourceKind: "inline_content",
    content: "# Synthetic notes\n\nInitial.", reference: null, mediaType: "text/markdown",
    sourceDescription: "Synthetic smoke fixture",
  });
  if (!record(editableDocument.document)) {
    throw new SmokeFailure("tool-operation", revision, "document-output", "Editable document creation output was incomplete.", "create_document");
  }
  await invokeTool(baseURL, revision, conversation, "update_document", {
    documentId: editableDocument.document.id,
    expectedVersion: editableDocument.document.currentVersion,
    content: "# Synthetic notes\n\nUpdated.", changeSummary: "Synthetic smoke update",
  });
  return { conversation, gigId, personId, documentId };
}

interface LocalResources {
  processes: Array<{ kill(signal?: number): void; exited: Promise<number> }>;
  stateRoot?: string;
}

async function cleanupLocal(resources: LocalResources) {
  for (const process of resources.processes.reverse()) {
    process.kill();
    const exited = await Promise.race([
      process.exited.then(() => true),
      Bun.sleep(3_000).then(() => false),
    ]);
    if (!exited) {
      process.kill(9);
      await process.exited;
    }
  }
  if (resources.stateRoot) await rm(resources.stateRoot, { recursive: true, force: true });
}

async function freePort() {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = listener.port;
  listener.stop(true);
  return port;
}

function startBuiltServer(
  revision: string,
  stateRoot: string,
  port: number,
  smokeMode: Mode,
  extraEnv: Record<string, string> = {},
) {
  return Bun.spawn(["bun", "dist/server/server.js"], {
    cwd: repositoryRoot,
    env: smokeEnvironment({
      HOST: "127.0.0.1",
      PORT: String(port),
      STATIC_ROOT: path.join(repositoryRoot, "dist/client"),
      APP_REVISION: revision,
      GIG_FINDER_CONTEXT_ROOT: stateRoot,
      GIG_FINDER_SMOKE_MODE: smokeMode,
      AI_SDK_DEVTOOLS: "false",
      LOG_LEVEL: "error",
      ...extraEnv,
    }),
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function initializeState(stateRoot: string, revision: string) {
  try {
    await command("bun", ["dist/server/maintenance.js", "initialize"], {
      env: smokeEnvironment({
        GIG_FINDER_CONTEXT_ROOT: stateRoot,
        LOG_LEVEL: "error",
      }),
    });
  } catch (error) {
    throw new SmokeFailure("health-and-migrations", revision, "database-initialize", reason(error));
  }
}

async function runDeterministic(revision: string) {
  const startedAt = Date.now();
  await requireClean(revision);
  await command("bun", ["run", "build"], { stdout: "inherit", stderr: "inherit" });
  const stateRoot = stateRootPath("deterministic");
  const resources: LocalResources = { processes: [], stateRoot };
  const interrupt = () => void cleanupLocal(resources).finally(() => process.exit(130));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await createStateRoot(stateRoot);
    await initializeState(stateRoot, revision);
    const mockPort = await freePort();
    const mock = Bun.spawn(["bun", "dist/server/smoke-provider-server.js"], {
      cwd: repositoryRoot,
      env: smokeEnvironment({ HOST: "127.0.0.1", PORT: String(mockPort) }),
      stdout: "ignore",
      stderr: "ignore",
    });
    resources.processes.push(mock);
    const mockBaseURL = `http://127.0.0.1:${mockPort}`;
    await waitForEndpoint(`${mockBaseURL}/status`, revision, "mock-provider-health");

    const appPort = await freePort();
    let application = startBuiltServer(revision, stateRoot, appPort, "deterministic", {
      GIG_FINDER_SMOKE_PROVIDER_URL: mockBaseURL,
    });
    resources.processes.push(application);
    const baseURL = `http://127.0.0.1:${appPort}`;
    const serverLog = path.join(stateRoot, "logs/server.log");
    await waitForHealth(baseURL, revision, "deterministic-health", serverLog);
    const state = await deterministicScenarios(baseURL, revision);

    application.kill();
    await Promise.race([application.exited, Bun.sleep(3_000)]);
    resources.processes = resources.processes.filter(process => process !== application);
    application = startBuiltServer(revision, stateRoot, appPort, "deterministic", {
      GIG_FINDER_SMOKE_PROVIDER_URL: mockBaseURL,
    });
    resources.processes.push(application);
    await waitForHealth(baseURL, revision, "restart-health", serverLog);
    const conversations = await (await fetch(`${baseURL}/api/agent/conversations`)).json() as { conversations?: unknown[] };
    const restored = await (await fetch(`${baseURL}/api/agent/conversations/${state.conversation}`)).json() as JsonRecord;
    if (!Array.isArray(conversations.conversations) || !record(restored.conversation) || !Array.isArray(restored.messages)) {
      throw new SmokeFailure("restart-persistence", revision, "restart-load", "Conversation did not survive application restart.");
    }
    const hydrationText = "SMOKE_DOCUMENT_CONTENT_67";
    const hydration = Buffer.from(hydrationText).toString("base64url");
    await sendMessage(
      baseURL,
      revision,
      state.conversation,
      `SMOKE_HYDRATION:restart-hydration:${hydration}`,
      "document-hydration",
    );
    const gigs = await (await fetch(`${baseURL}/api/gigs`)).json() as unknown;
    const people = await (await fetch(`${baseURL}/api/people`)).json() as unknown;
    if (!JSON.stringify(gigs).includes(state.gigId) || !JSON.stringify(people).includes(state.personId)) {
      throw new SmokeFailure("restart-persistence", revision, "restart-records", "Synthetic records did not survive application restart.");
    }
    const providerStatus = await (await fetch(`${mockBaseURL}/status`)).json() as JsonRecord;
    const seenTools = Array.isArray(providerStatus.seenTools) ? providerStatus.seenTools.map(String).sort() : [];
    if (JSON.stringify(seenTools) !== JSON.stringify(expectedTools)) {
      throw new SmokeFailure("registry-parity", revision, "provider-status", "Not every registered tool operation was observed.");
    }
    if (Number(providerStatus.hydrationValidations) < 1 || Number(providerStatus.registryValidations) < expectedTools.length) {
      throw new SmokeFailure("provider-validation", revision, "provider-status", "Provider validation or hydration evidence is incomplete.");
    }
    return {
      mode: "deterministic",
      revision,
      tools: seenTools.length,
      registryValidations: providerStatus.registryValidations,
      restart: "passed",
      hydration: "passed",
      durationMs: Date.now() - startedAt,
    };
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await cleanupLocal(resources);
  }
}

async function waitForEndpoint(url: string, revision: string, correlationId: string) {
  let last = "not ready";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = reason(error);
    }
    await Bun.sleep(250);
  }
  throw new SmokeFailure("provider-health", revision, correlationId, last);
}

async function latestLoggedError(logPath: string) {
  try {
    const lines = (await readFile(logPath, "utf8")).trim().split("\n").reverse();
    for (const line of lines) {
      const parsed: unknown = JSON.parse(line);
      if (!record(parsed) || Number(parsed.level) < 50) continue;
      if (record(parsed.err) && typeof parsed.err.message === "string") return reason(parsed.err.message);
      if (typeof parsed.msg === "string") return reason(parsed.msg);
    }
  } catch { /* a provider failure can occur before a log file is written */ }
  return null;
}

async function liveScoutScreening(stateRoot:string,timeoutMs:number){
  const databasePath=path.join(stateRoot,"data","scout-live-model.sqlite");
  const descriptionsRoot=path.join(stateRoot,"artifacts","scout-live-model");
  await mkdir(descriptionsRoot,{recursive:true});
  const database=openDatabase(databasePath);
  try{
    migrateDatabase(database);
    const now="2026-08-20T00:00:00.000Z",positionId="smoke-live-scout-position",description="Lead a synthetic software engineering organization, develop engineering leaders, and own reliable delivery of a business software platform.";
    const descriptionHash=createHash("sha256").update(description).digest("hex"),relative=`${descriptionHash}.md`,artifactId=`smoke-live-artifact-${descriptionHash.slice(0,12)}`,descriptionId="smoke-live-description";
    await writeFile(path.join(descriptionsRoot,relative),description);
    const profile=JSON.parse(await readFile(path.join(stateRoot,"profile","candidate-profile.json"),"utf8")) as unknown;
    const profileHash=createHash("sha256").update(JSON.stringify(profile)).digest("hex"),model="gpt-5.6-sol",modelConfiguration="structured-v1:maxRetries=1";
    database.exec(`INSERT INTO scout_companies(id,name,created_at,updated_at) VALUES('smoke-live-company','Synthetic Systems','${now}','${now}');`);
    database.query(`INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,external_id,canonical_url,title,location,first_seen_at,last_seen_at) VALUES(?,'smoke-live-company','official','external_id','smoke-live-role','smoke-live-role','https://example.invalid/jobs/smoke-live-role','Director of Software Engineering','Remote',?,?)`).run(positionId,now,now);
    database.query(`INSERT INTO scout_position_states(position_id,state,revision,created_at,updated_at) VALUES(?,'processing',1,?,?)`).run(positionId,now,now);
    database.query(`INSERT INTO scout_description_artifacts(id,file_path,content_hash,media_type,byte_count,provenance_json,created_at) VALUES(?,?,?,'text/markdown',?,'{}',?)`).run(artifactId,relative,descriptionHash,Buffer.byteLength(description),now);
    database.query(`INSERT INTO scout_position_descriptions(id,position_id,artifact_id,source_url,retrieved_at,source_content_hash,markdown_content_hash,converter_version,created_at) VALUES(?,?,?,'https://example.invalid/jobs/smoke-live-role',?,?,?,?,?,?)`).run(descriptionId,positionId,artifactId,now,descriptionHash,descriptionHash,"html-to-markdown-v1",now);
    database.exec(`
      INSERT INTO scout_company_configurations(id,company_id,version,fingerprint,created_at) VALUES('smoke-live-config','smoke-live-company',1,'smoke-live-fingerprint','${now}');
      INSERT INTO scout_company_configuration_sources(id,company_configuration_id,source_key,source_type,settings_json) VALUES('smoke-live-source-config','smoke-live-config','official','json','{}');
      INSERT INTO scout_runs(id,status,batch_size,concurrency,created_at,company_count,search_profile_json,screening_cache_key,candidate_profile_json,candidate_profile_version,candidate_profile_artifact_id,candidate_profile_hash) VALUES('smoke-live-run','completed',1,1,'${now}',1,'{"terms":[],"locations":[]}','smoke-live-run-cache-key','${JSON.stringify(profile).replaceAll("'","''")}','smoke-live-profile-v1','smoke-live-profile-artifact','${profileHash}');
      INSERT INTO scout_run_companies(id,run_id,company_id,company_configuration_id,status) VALUES('smoke-live-run-company','smoke-live-run','smoke-live-company','smoke-live-config','succeeded');
      INSERT INTO scout_run_sources(id,run_company_id,configuration_source_id,status,candidate_count,accepted_count,rejected_count) VALUES('smoke-live-run-source','smoke-live-run-company','smoke-live-source-config','succeeded_with_results',1,1,0);
      INSERT INTO scout_position_observations(id,run_source_id,position_id,description_artifact_id,title,canonical_url,location,provenance_json,observed_at) VALUES('smoke-live-observation','smoke-live-run-source','${positionId}','${artifactId}','Director of Software Engineering','https://example.invalid/jobs/smoke-live-role','Remote','{}','${now}');
    `);
    const criteria=database.query(`SELECT version,prompt_version promptVersion FROM scout_relevance_criteria ORDER BY version DESC LIMIT 1`).get() as {version:number;promptVersion:string};
    const relevanceIdentity=createHash("sha256").update(JSON.stringify({positionId,descriptionHash,criteriaVersion:criteria.version,promptVersion:criteria.promptVersion,model,modelConfiguration})).digest("hex"),processingId="smoke-live-relevance-processing";
    database.query(`INSERT INTO scout_position_processing(id,position_id,stage,input_identity,status,created_at,updated_at) VALUES(?,?,'screen_relevance',?,'pending',?,?)`).run(processingId,positionId,relevanceIdentity,now,now);
    const screeningInputs={profile,profileVersion:"smoke-live-profile-v1",profileArtifactId:"smoke-live-profile-artifact",profileHash,model,provider:"openai-codex",modelConfiguration};
    const store=new SqliteScoutRunStore(database,descriptionsRoot,screeningInputs);
    const screening=new AiSdkScoutScreeningModel(()=>createCodexLanguageModel(model,{surfaceLiveSmokeErrors:true}),{provider:"openai-codex",model,configuration:modelConfiguration});
    const processor=new ScoutPositionProcessor(store,screening);
    await Promise.race([processor.process(processingId),Bun.sleep(timeoutMs).then(()=>{throw new Error("Live Scout relevance call timed out.");})]);
    const scoring=store.pendingPositionJobs(10).find(job=>job.stage==="score_candidate_match");
    if(!scoring)throw new Error("Live Scout relevance result did not create scoring work.");
    await Promise.race([processor.process(scoring.id),Bun.sleep(timeoutMs).then(()=>{throw new Error("Live Scout scoring call timed out.");})]);
    const result=database.query(`SELECT s.state,m.score,m.score_explanation scoreExplanation,r.reason,m.cache_read_tokens cacheReadTokens,m.cache_write_tokens cacheWriteTokens FROM scout_position_states s JOIN scout_candidate_match_evaluations m ON m.position_id=s.position_id JOIN scout_relevance_evaluations r ON r.id=m.relevance_evaluation_id WHERE s.position_id=?`).get(positionId) as {state:string;score:number;scoreExplanation:string;reason:string;cacheReadTokens:number|null;cacheWriteTokens:number|null}|null;
    if(!result||result.state!=="needs_user_review"||result.score<1||result.score>10||result.reason.length>255||result.scoreExplanation.length>310)throw new Error("Live Scout structured results were not persisted within contract bounds.");
    return{state:result.state,score:result.score,reasonCharacters:result.reason.length,scoreExplanationCharacters:result.scoreExplanation.length,cacheReadTokens:result.cacheReadTokens,cacheWriteTokens:result.cacheWriteTokens};
  }finally{database.close();}
}

async function runLive(revision: string) {
  const startedAt = Date.now();
  await requireClean(revision);
  const codexHome = path.resolve(Bun.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex"));
  try {
    await stat(path.join(codexHome, "auth.json"));
  } catch {
    throw new SmokeFailure("authentication", revision, "live-auth", "Codex authentication is unavailable. Run `codex login`.");
  }
  await command("bun", ["run", "build"], { stdout: "inherit", stderr: "inherit" });
  const stateRoot = stateRootPath("live");
  const resources: LocalResources = {
    processes: [],
    stateRoot,
  };
  const interrupt = () => void cleanupLocal(resources).finally(() => process.exit(130));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await createStateRoot(stateRoot);
    await initializeState(stateRoot, revision);
    const port = await freePort();
    const server = startBuiltServer(revision, stateRoot, port, "live", { CODEX_HOME: codexHome });
    resources.processes.push(server);
    const baseURL = `http://127.0.0.1:${port}`;
    await waitForHealth(baseURL, revision, "live-health", path.join(stateRoot, "logs/server.log"));
    const timeoutMs = Number(Bun.env.SMOKE_LIVE_TIMEOUT_MS ?? "90000");
    const scoutScreening=await liveScoutScreening(stateRoot,timeoutMs);
    let response: Awaited<ReturnType<typeof sendMessage>>;
    try {
      response = await sendMessage(
        baseURL,
        revision,
        "smoke-live-67",
        "This is a bounded synthetic pre-release smoke check. Do not create, update, delete, or revert anything. Reply briefly that the registry is accepted, or make one harmless read-only list call.",
        "live-provider",
        undefined,
        timeoutMs,
      );
    } catch (error) {
      if (error instanceof SmokeFailure) {
        const detail = await latestLoggedError(path.join(stateRoot, "logs/server.log"));
        if (detail) throw new SmokeFailure(error.phase, revision, error.correlationId, detail, error.tool);
      }
      throw error;
    }
    const tools = response.events
      .filter(event => event.type === "tool-input-available" && typeof event.toolName === "string")
      .map(event => String(event.toolName));
    const unsafe = tools.find(tool => mutationTools.has(tool));
    if (unsafe) throw new SmokeFailure("live-provider", revision, response.correlationId, "Live smoke attempted a mutation.", unsafe);
    const text = response.events
      .filter(event => event.type === "text-delta" && typeof event.delta === "string")
      .map(event => String(event.delta)).join("");
    if (!text.trim() && tools.length === 0) {
      throw new SmokeFailure("live-provider", revision, response.correlationId, "Provider returned neither a normal response nor a harmless read-only tool call.");
    }
    return {
      mode: "live",
      revision,
      outcome: text.trim() ? "normal-response" : "read-only-tool",
      readOnlyTools: tools,
      scoutScreening,
      timeoutMs,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await cleanupLocal(resources);
  }
}

if (mode !== "deterministic" && mode !== "live") {
  console.error("Usage: bun run scripts/smoke.ts <deterministic|live>");
  process.exit(2);
}

try {
  const head = await revision();
  const result = mode === "deterministic" ? await runDeterministic(head) : await runLive(head);
  console.log(JSON.stringify({ status: "passed", ...result }));
  process.exit(0);
} catch (error) {
  if (error instanceof SmokeFailure) {
    console.error(JSON.stringify({
      status: "failed",
      mode,
      phase: error.phase,
      revision: error.revision,
      correlationId: error.correlationId,
      ...(error.tool ? { tool: error.tool } : {}),
      reason: reason(error.message),
    }));
  } else {
    console.error(JSON.stringify({ status: "failed", mode, phase: "orchestration", reason: reason(error) }));
  }
  process.exit(1);
}
