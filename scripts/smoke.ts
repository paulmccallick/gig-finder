import { chmod, copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { gigFinderToolSchemas } from "../src/agent/gig-finder-tools";

type Mode = "deterministic" | "live";
type JsonRecord = Record<string, unknown>;

const repositoryRoot = path.resolve(import.meta.dir, "..");
const mode = process.argv[2] as Mode | undefined;
const expectedTools = Object.keys(gigFinderToolSchemas).sort();
const mutationTools = new Set([
  "create_gig", "update_gig", "create_person", "update_person",
  "create_gig_person_relationship", "create_task", "update_task",
  "create_interaction", "update_interaction", "delete_interaction",
  "create_document", "update_document", "revert_change",
]);

const record = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const reason = (value: unknown) => (value instanceof Error ? value.message : String(value))
  .replace(/\s+/g, " ").slice(0, 300);

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

async function createStateRoot(runMode: Mode) {
  const root = path.join(repositoryRoot, "tmp", `smoke-${runMode}-${process.pid}-${crypto.randomUUID()}`);
  for (const directory of ["data", "profile", "profile/documents", "artifacts", "logs", "backups"]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(path.join(root, "config.json"), JSON.stringify({ version: 1, actor: "Synthetic Smoke Candidate" }));
  await copyFile(
    path.join(repositoryRoot, "src/web/test/fixtures/candidate-profile.json"),
    path.join(root, "profile/candidate-profile.json"),
  );
  await writeFile(path.join(root, "upload.md"), "# Synthetic role\n\nSMOKE_DOCUMENT_CONTENT_67\n");
  await chmod(root, 0o777);
  for (const directory of ["data", "profile", "profile/documents", "artifacts", "logs", "backups"]) {
    await chmod(path.join(root, directory), 0o777);
  }
  return root;
}

async function waitForHealth(baseURL: string, expectedRevision: string, correlationId: string) {
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
    throw new SmokeFailure("tool-operation", revision, result.correlationId, `Tool returned ${String(output.status)}.`, tool);
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
  await invokeTool(baseURL, revision, conversation, "update_document", {
    documentId, expectedVersion: createdDocument.document.currentVersion,
    content: "# Synthetic role\n\nSMOKE_DOCUMENT_CONTENT_67\n\nUpdated.", changeSummary: "Synthetic smoke update",
  });
  return { conversation, gigId, personId, documentId };
}

interface DockerResources {
  containers: string[];
  network?: string;
  stateRoot?: string;
  builtImage?: string;
}

async function cleanupDocker(resources: DockerResources) {
  for (const container of resources.containers.reverse()) {
    try { await command("docker", ["stop", "--time", "3", container]); } catch { /* best effort */ }
  }
  if (resources.network) {
    try { await command("docker", ["network", "rm", resources.network]); } catch { /* best effort */ }
  }
  if (resources.builtImage) {
    try { await command("docker", ["image", "rm", resources.builtImage]); } catch { /* best effort */ }
  }
  if (resources.stateRoot) await rm(resources.stateRoot, { recursive: true, force: true });
}

async function mappedPort(container: string, containerPort: string) {
  const mapping = await command("docker", ["port", container, containerPort]);
  const port = Number(mapping.split("\n")[0]?.match(/:(\d+)$/)?.[1]);
  if (!Number.isInteger(port)) throw new Error(`Could not resolve mapped port for ${containerPort}.`);
  return port;
}

async function startApplicationContainer(image: string, network: string, stateRoot: string) {
  const id = await command("docker", [
    "run", "--detach", "--rm", "--network", network,
    "-p", "127.0.0.1::3001",
    "-e", "GIG_FINDER_CONTEXT_ROOT=/var/lib/gig-finder",
    "-e", "GIG_FINDER_SMOKE_MODE=deterministic",
    "-e", "GIG_FINDER_SMOKE_PROVIDER_URL=http://smoke-provider:4010",
    "-e", "LOG_LEVEL=error",
    "-v", `${stateRoot}:/var/lib/gig-finder`, image,
  ]);
  return { id, baseURL: `http://127.0.0.1:${await mappedPort(id, "3001/tcp")}` };
}

async function runDeterministic(revision: string) {
  const startedAt = Date.now();
  const resources: DockerResources = { containers: [] };
  const interrupt = () => void cleanupDocker(resources).finally(() => process.exit(130));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const suppliedImage = Bun.env.SMOKE_IMAGE?.trim();
    let image = suppliedImage;
    if (!image) {
      await requireClean(revision);
      image = `gig-finder-smoke:${revision}`;
      await command("docker", ["build", "--build-arg", `GIT_REVISION=${revision}`, "--tag", image, "."], { stdout: "inherit", stderr: "inherit" });
      resources.builtImage = image;
    }
    resources.stateRoot = await createStateRoot("deterministic");
    resources.network = `gig-finder-smoke-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    await command("docker", ["network", "create", resources.network]);
    const mockId = await command("docker", [
      "run", "--detach", "--rm", "--network", resources.network, "--network-alias", "smoke-provider",
      "-p", "127.0.0.1::4010", image, "bun", "dist/server/smoke-provider-server.js",
    ]);
    resources.containers.push(mockId);
    const mockBaseURL = `http://127.0.0.1:${await mappedPort(mockId, "4010/tcp")}`;
    await command("docker", [
      "run", "--rm", "-e", "GIG_FINDER_CONTEXT_ROOT=/var/lib/gig-finder",
      "-v", `${resources.stateRoot}:/var/lib/gig-finder`, image,
      "bun", "dist/server/maintenance.js", "initialize",
    ]);
    let application = await startApplicationContainer(image, resources.network, resources.stateRoot);
    resources.containers.push(application.id);
    await waitForHealth(application.baseURL, revision, "deterministic-health");
    const state = await deterministicScenarios(application.baseURL, revision);

    await command("docker", ["stop", "--time", "3", application.id]);
    resources.containers = resources.containers.filter(id => id !== application.id);
    application = await startApplicationContainer(image, resources.network, resources.stateRoot);
    resources.containers.push(application.id);
    await waitForHealth(application.baseURL, revision, "restart-health");
    const conversations = await (await fetch(`${application.baseURL}/api/agent/conversations`)).json() as { conversations?: unknown[] };
    const restored = await (await fetch(`${application.baseURL}/api/agent/conversations/${state.conversation}`)).json() as JsonRecord;
    if (!Array.isArray(conversations.conversations) || !record(restored.conversation) || !Array.isArray(restored.messages)) {
      throw new SmokeFailure("restart-persistence", revision, "restart-load", "Conversation did not survive application restart.");
    }
    const hydrationText = "SMOKE_DOCUMENT_CONTENT_67";
    const hydration = Buffer.from(hydrationText).toString("base64url");
    await sendMessage(
      application.baseURL,
      revision,
      state.conversation,
      `SMOKE_HYDRATION:restart-hydration:${hydration}`,
      "document-hydration",
    );
    const gigs = await (await fetch(`${application.baseURL}/api/gigs`)).json() as unknown;
    const people = await (await fetch(`${application.baseURL}/api/people`)).json() as unknown;
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
      image,
      tools: seenTools.length,
      registryValidations: providerStatus.registryValidations,
      restart: "passed",
      hydration: "passed",
      durationMs: Date.now() - startedAt,
    };
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await cleanupDocker(resources);
  }
}

async function freePort() {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = listener.port;
  listener.stop(true);
  return port;
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
  const stateRoot = await createStateRoot("live");
  const port = await freePort();
  const server = Bun.spawn(["bun", "dist/server/server.js"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      STATIC_ROOT: path.join(repositoryRoot, "dist/client"),
      APP_REVISION: revision,
      GIG_FINDER_CONTEXT_ROOT: stateRoot,
      GIG_FINDER_SMOKE_MODE: "live",
      CODEX_HOME: codexHome,
      AI_SDK_DEVTOOLS: "false",
      LOG_LEVEL: "error",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const cleanup = async () => {
    server.kill("SIGTERM");
    await Promise.race([server.exited, Bun.sleep(3_000)]);
    await rm(stateRoot, { recursive: true, force: true });
  };
  const interrupt = () => void cleanup().finally(() => process.exit(130));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const baseURL = `http://127.0.0.1:${port}`;
    await waitForHealth(baseURL, revision, "live-health");
    const timeoutMs = Number(Bun.env.SMOKE_LIVE_TIMEOUT_MS ?? "90000");
    const response = await sendMessage(
      baseURL,
      revision,
      "smoke-live-67",
      "This is a bounded synthetic pre-release smoke check. Do not create, update, delete, or revert anything. Reply briefly that the registry is accepted, or make one harmless read-only list call.",
      "live-provider",
      undefined,
      timeoutMs,
    );
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
      timeoutMs,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await cleanup();
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
