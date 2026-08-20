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
import { importScoutCompany } from "../../core/scout/engine/company-import";
import {
  DataStore,
  migrateDatabase,
  openDatabase,
  SqliteScoutCompanyImportStore,
} from "../../data";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const contextRoot = path.join(repoRoot, "tmp", "e2e-context");
const databasePath = path.join(contextRoot, "data", "gig-finder.sqlite");
const apiPort = "3002";
const clientPort = "5174";
const scoutSourcePort = 3003;
const scoutSourceKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg8WFHpiCviUJgtqZB
WT8mWSYBgemULzdbj6KacLkOXnKhRANCAASZyVRLZ5AXijf6UjaAhEpCsI/5mS9e
KMzvzFmFKdOicPofPBaf3erOxYGOfnpqMNFl392/YRel0++Qgh48rGoR
-----END PRIVATE KEY-----`;
const scoutSourceCertificate = `-----BEGIN CERTIFICATE-----
MIIBjTCCATSgAwIBAgIUI4+SHwu+Ve4Wm2I8y4JR/8SgINgwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDgyMDE4NTQzNVoXDTM2MDgxNzE4
NTQzNVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEmclUS2eQF4o3+lI2gIRKQrCP+ZkvXijM78xZhSnTonD6HzwWn93qzsWB
jn56ajDRZd/dv2EXpdPvkIIePKxqEaNkMGIwHQYDVR0OBBYEFH9Hb30MQTwAzSHg
9csb5VJjYcn8MB8GA1UdIwQYMBaAFH9Hb30MQTwAzSHg9csb5VJjYcn8MA8GA1Ud
EwEB/wQFMAMBAf8wDwYDVR0RBAgwBocEfwAAATAKBggqhkjOPQQDAgNHADBEAiAt
Q+XOIJfuKXy4aQjNhUcgQB5U7zfD0Vp/lDh7TDftUgIgJVjWQgaIldCR+bRgD5yq
lD5mGIMVApUtjr2V5GQojtg=
-----END CERTIFICATE-----`;

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
  "Prepare for the interview.",
  "",
  "```mermaid",
  "flowchart LR",
  "  Prepare --> Interview",
  "```",
  "",
  "```mermaid",
  "this is not valid mermaid",
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
const scoutImport = importScoutCompany(
  {
    id: "company-e2e-scout",
    name: "Example Labs",
    active: true,
    sources: [
      {
        key: "official",
        type: "json",
        url: `https://127.0.0.1:${scoutSourcePort}/jobs`,
        active: true,
        method: "GET",
        recordsPath: "jobs",
        fields: {
          id: "id",
          title: "title",
          url: "url",
          location: "workplace",
          description: "description",
        },
      },
    ],
  },
  new SqliteScoutCompanyImportStore(database),
);
if (scoutImport.rejected)
  throw new Error("Could not create the synthetic Scout company fixture.");
database.close();

const scoutSource = Bun.serve({
  hostname: "127.0.0.1",
  port: scoutSourcePort,
  tls: { key: scoutSourceKey, cert: scoutSourceCertificate },
  fetch(request) {
    if (new URL(request.url).pathname !== "/jobs")
      return new Response("Not found", { status: 404 });
    return Response.json({
      jobs: [
        {
          id: "example-1",
          title: "Director of Synthetic Systems",
          url: `https://127.0.0.1:${scoutSourcePort}/jobs/example-1`,
          workplace: "Synthetic Region",
          description: "Lead the synthetic systems organization.",
        },
        {
          id: "untracked-1",
          title: "Head of Orchard Technology",
          url: `https://127.0.0.1:${scoutSourcePort}/jobs/untracked-1`,
          workplace: "Synthetic Region",
          description: "Build and lead the orchard technology team.",
        },
      ],
    });
  },
});

const environment = {
  ...process.env,
  PORT: apiPort,
  GIG_FINDER_CONTEXT_ROOT: contextRoot,
  AI_SDK_DEVTOOLS: "false",
  LOG_LEVEL: "error",
  NODE_TLS_REJECT_UNAUTHORIZED: "0",
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
  void scoutSource.stop(true);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race([api.exited, client.exited]);
stop();
