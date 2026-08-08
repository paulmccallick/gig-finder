import { mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type {
  ChangeContext,
  GigData,
  PersonData,
  TaskData,
} from "../../core/models";
import type { ManagedDocumentData } from "../../core/documents";
import { DataStore, migrateDatabase, openDatabase } from "../../data";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const contextRoot = path.join(repoRoot, "tmp", "e2e-context");
const databasePath = path.join(contextRoot, "data", "gig-finder.sqlite");
const apiPort = "3002";
const clientPort = "5174";

rmSync(contextRoot, { recursive: true, force: true });
mkdirSync(path.join(contextRoot, "data"), { recursive: true });
mkdirSync(path.join(contextRoot, "profile"), { recursive: true });
mkdirSync(path.join(contextRoot, "artifacts"), { recursive: true });

await Bun.write(path.join(contextRoot, "config.json"), JSON.stringify({
  version: 1,
  actor: "E2E Candidate",
}));
await Bun.write(path.join(contextRoot, "profile", "candidate-profile.json"), JSON.stringify({
  version: "1",
  candidate: {
    displayName: "Jordan",
    profession: "Product and operations leadership",
    functionalFocus: ["Product development", "Cross-functional delivery"],
    experienceLevel: "Experienced people leader",
    yearsOfExperience: "More than ten years",
    industryExperience: ["Consumer services", "Business software"],
    currentSituation: "Conducting an active gig search.",
    careerHorizon: "Long term.",
  },
  targets: {
    primaryRoles: ["Director of Product"],
    conditionalRoles: ["Head of Product at a smaller company"],
    companyPreferences: ["Stable product companies"],
    locationPreferences: ["Hybrid", "Remote"],
  },
  strengths: ["Building teams", "Delivering customer outcomes"],
  bestFitDomains: ["Product development"],
  poorFit: ["Individual-contributor roles"],
  decisionRules: ["Prioritize credible scope and company stability."],
}));

const timestamp = "2026-07-21T12:00:00.000Z";
const change: ChangeContext = {
  actor: "e2e",
  source: "test",
  summary: "Create synthetic dashboard fixture",
  occurredAt: timestamp,
};
const gigs: GigData[] = [
  {
    id: "gig-active", company: "Example Labs", title: "Director of Product",
    externalJobId: "example-1", stage: "applied", outcome: "pending",
    statusSummary: "Application submitted", lastActivity: "2026-07-21",
    nextActionDescription: "Prepare for recruiter call", nextActionDue: "2026-07-23",
    fitRating: "strong", fitSummary: "Strong leadership scope", payCurrency: "USD",
    payMinimum: 180000, payMaximum: 220000, payPeriod: "year", payNotes: null,
    sourceUrl: "https://example.com/jobs/1", location: "Seattle", workArrangement: "hybrid",
    postedDate: "2026-07-15", businessUnitTeam: "Product", recruiterSource: "Referral",
    bonus: null, equity: null, otherCompensation: null, tagsJson: "[]",
    hasJobDescription: false, hasInterviewPrep: false,
  },
  {
    id: "gig-archive", company: "Sample Systems", title: "VP Product",
    externalJobId: "example-2", stage: "closed", outcome: "rejected",
    statusSummary: "Search concluded", lastActivity: "2026-07-18",
    nextActionDescription: null, nextActionDue: null, fitRating: "good",
    fitSummary: null, payCurrency: null, payMinimum: null, payMaximum: null,
    payPeriod: null, payNotes: null, sourceUrl: null, location: null,
    workArrangement: null, postedDate: null, businessUnitTeam: null,
    recruiterSource: null, bonus: null, equity: null, otherCompensation: null,
    tagsJson: "[]", hasJobDescription: false, hasInterviewPrep: false,
  },
];
const person: PersonData = {
  id: "person-one", name: "Alex Example", company: "Example Labs", title: "VP Product",
  linkedInProfileUrl: "https://www.linkedin.com/in/alex-example", connectedOn: "2024-01-01",
  relationshipType: "former_peer", relationshipStrength: "strong", introducedBy: null,
  relationshipNotes: "Worked together on a product launch.", priority: "high",
  status: "active_relationship", whyInteresting: "Knows the hiring team.",
  notesJson: "[]", tagsJson: "[]",
};
const task: TaskData = {
  id: "task-one", title: "Prepare questions", type: "application", status: "open",
  priority: "high", dueDate: "2026-07-23", relatedEntityType: "gig",
  relatedEntityId: "gig-active", relatedEntityLabel: "Example Labs Director of Product",
  notes: "Review the role scope.", completedAt: null,
};
const document: ManagedDocumentData = {
  id: "doc_11111111-1111-4111-8111-111111111111",
  links: [{ entityType: "gig", entityId: "gig-active" }],
  documentType: "interview_prep",
  title: "Interview Brief",
  description: null,
  mediaType: "text/markdown",
  sourceDescription: "Synthetic browser fixture",
  filePath: null,
  uploadProvenance: null,
};
const documentContent = [
  "# Interview Brief",
  "",
  "- Review the product strategy",
  "- Prepare leadership examples",
  "",
  "```mermaid",
  "flowchart LR",
  "  Prepare --> Interview",
  "```",
  "",
  "<script>window.compromised = true</script>",
].join("\n");

const database = openDatabase(databasePath);
migrateDatabase(database);
const store = new DataStore(database);
store.change(change, transaction => {
  gigs.forEach(gig => transaction.gigs.create(gig));
  transaction.people.create(person);
  transaction.tasks.create(task);
  transaction.documents.create({
    document,
    content: documentContent,
    contentHash: createHash("sha256").update(documentContent).digest("hex"),
  });
});
database.close();

const environment = {
  ...process.env,
  PORT: apiPort,
  GIG_FINDER_CONTEXT_ROOT: contextRoot,
  AI_SDK_DEVTOOLS: "false",
  LOG_LEVEL: "error",
};
const api = Bun.spawn(["bun", "src/web/server.ts"], {
  cwd: repoRoot,
  env: environment,
  stdout: "inherit",
  stderr: "inherit",
});
const client = Bun.spawn([
  "bun", "x", "vite", "--config", "src/web/vite.config.ts",
  "--host", "127.0.0.1", "--port", clientPort, "--strictPort",
], {
  cwd: repoRoot,
  env: environment,
  stdout: "inherit",
  stderr: "inherit",
});

const stop = () => {
  api.kill();
  client.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race([api.exited, client.exited]);
stop();
