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
  SqliteScoutRunStore,
} from "../../data";
import { ScoutPositionProcessor, type ScoutScreeningModel } from "../../core/scout/engine/screening";
import { createSmokeProviderState, smokeProviderHandler } from "../../../scripts/smoke-support/scripted-provider";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const contextRoot = path.join(repoRoot, "tmp", "e2e-context");
const databasePath = path.join(contextRoot, "data", "gig-finder.sqlite");
const apiPort = "3002";
const clientPort = "5174";
const scoutSourcePort = 3003;
const screeningProviderPort = 3004;
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
    id: "gig-unavailable-newest", company: "Unavailable New Systems",
    title: "Director of New Signals", externalJobId: "UNAVAILABLE-NEW",
    stage: "screening", outcome: "pending",
    statusSummary: "Official posting no longer listed", lastActivity: "2026-08-28",
    nextActionDescription: "Decide whether to archive", nextActionDue: "2026-08-30",
    fitRating: "strong", fitSummary: "Synthetic unavailable fixture",
    payCurrency: null, payMinimum: null, payMaximum: null, payPeriod: null, payNotes: null,
    sourceUrl: "https://careers.example.test/jobs/unavailable-new", location: null,
    workArrangement: null, postedDate: null, businessUnitTeam: null,
    recruiterSource: null, bonus: null, equity: null, otherCompensation: null,
    tagsJson: "[]", availability: "unavailable",
    availabilityUpdatedAt: "2026-08-29T18:00:00.000Z",
  },
  {
    id: "gig-unavailable-older", company: "Unavailable Older Works",
    title: "VP of Earlier Signals", externalJobId: "UNAVAILABLE-OLDER",
    stage: "identified", outcome: "pending",
    statusSummary: "Official posting unavailable in earlier scan", lastActivity: "2026-08-26",
    nextActionDescription: "Review alternate openings", nextActionDue: "2026-08-27",
    fitRating: "good", fitSummary: "Synthetic older unavailable fixture",
    payCurrency: null, payMinimum: null, payMaximum: null, payPeriod: null, payNotes: null,
    sourceUrl: "https://careers.example.test/jobs/unavailable-older", location: null,
    workArrangement: null, postedDate: null, businessUnitTeam: null,
    recruiterSource: null, bonus: null, equity: null, otherCompensation: null,
    tagsJson: "[]", availability: "unavailable",
    availabilityUpdatedAt: "2026-08-27T18:00:00.000Z",
  },
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
    availability: "unknown", availabilityUpdatedAt: null,
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
    tagsJson: "[]", availability: "unknown", availabilityUpdatedAt: null,
  },
  {
    id: "gig-identity-existing", company: "Example Labs", title: "Director of Identity Platforms",
    externalJobId: "IDENTITY-EXACT", stage: "applied", outcome: "pending",
    statusSummary: "Synthetic application in progress", lastActivity: "2026-08-20",
    nextActionDescription: "Prepare identity platform examples", nextActionDue: "2026-09-05",
    fitRating: "strong", fitSummary: "Strong synthetic identity leadership scope",
    payCurrency: null, payMinimum: null, payMaximum: null, payPeriod: null, payNotes: null,
    sourceUrl: "https://legacy.example.test/jobs/identity-exact", location: "Remote",
    workArrangement: "remote", postedDate: "2026-08-10", businessUnitTeam: "Identity",
    recruiterSource: "Synthetic referral", bonus: null, equity: null, otherCompensation: null,
    tagsJson: "[]",
    availability: "available", availabilityUpdatedAt: "2026-08-20T12:00:00.000Z",
  },
  {
    id: "gig-managed-description", company: "Synthetic Company", title: "Director",
    externalJobId: "SYN-149", stage: "applied", outcome: "pending",
    statusSummary: "Synthetic managed description fixture", lastActivity: "2026-08-21",
    nextActionDescription: null, nextActionDue: null, fitRating: "strong", fitSummary: null,
    payCurrency: null, payMinimum: null, payMaximum: null, payPeriod: null, payNotes: null,
    sourceUrl: "https://careers.example.test/jobs/SYN-149", location: "Remote",
    workArrangement: "remote", postedDate: "2026-08-21", businessUnitTeam: null,
    recruiterSource: null, bonus: null, equity: null, otherCompensation: null,
    tagsJson: "[]",
    availability: "available", availabilityUpdatedAt: "2026-08-21T12:00:00.000Z",
  },
  {
    id: "gig-completed-repair-changed", company: "Example Labs",
    title: "Synthetic Health Cooperative Director", externalJobId: "SYN-149",
    stage: "applied", outcome: "pending", statusSummary: "Promoted before canonical repair",
    lastActivity: "2026-08-22", nextActionDescription: null, nextActionDue: null,
    fitRating: "strong", fitSummary: null, payCurrency: null, payMinimum: null,
    payMaximum: null, payPeriod: null, payNotes: null,
    sourceUrl: "https://search.example.test/api/jobs?tenant=synthetic", location: "Remote",
    workArrangement: "remote", postedDate: "2026-08-22", businessUnitTeam: null,
    recruiterSource: null, bonus: null, equity: null, otherCompensation: null, tagsJson: "[]",
    availability: "available", availabilityUpdatedAt: "2026-08-22T12:00:00.000Z",
  },
  {
    id: "gig-completed-repair-unchanged", company: "Example Labs",
    title: "Synthetic Credit Cooperative Director", externalJobId: "SYN-150",
    stage: "applied", outcome: "pending", statusSummary: "Promoted before canonical repair",
    lastActivity: "2026-08-22", nextActionDescription: null, nextActionDue: null,
    fitRating: "strong", fitSummary: null, payCurrency: null, payMinimum: null,
    payMaximum: null, payPeriod: null, payNotes: null,
    sourceUrl: "https://search.example.test/api/jobs?tenant=synthetic-stable", location: "Remote",
    workArrangement: "remote", postedDate: "2026-08-22", businessUnitTeam: null,
    recruiterSource: null, bonus: null, equity: null, otherCompensation: null, tagsJson: "[]",
    availability: "available", availabilityUpdatedAt: "2026-08-22T12:00:00.000Z",
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
const identityDocument: ManagedDocumentData = {
  id: "doc_22222222-2222-4222-8222-222222222222",
  links: [{ entityType: "gig", entityId: "gig-identity-existing" }],
  documentType: "job_description",
  title: "Example Labs — Director of Identity Platforms",
  description: null,
  mediaType: "text/markdown",
  sourceDescription: "Synthetic pre-Scout identity fixture",
  filePath: null,
  uploadProvenance: null,
};
const identityDocumentContent = "# Existing identity platform role\n\nOriginal synthetic role description.";
const managedDescriptionDocument: ManagedDocumentData = {
  id: "doc_14900000-0000-4000-8000-000000000149",
  links: [{ entityType: "gig", entityId: "gig-managed-description" }],
  documentType: "job_description",
  title: "Synthetic Company — Director",
  description: null,
  mediaType: "text/markdown",
  sourceDescription: "Synthetic managed drawer fixture",
  filePath: null,
  uploadProvenance: null,
};
const managedDescriptionContent = "# Synthetic managed description\n\nManaged Markdown is authoritative.";
const repairDocuments = [
  {
    document: {
      id: "doc_14900000-0000-4000-8000-000000000150",
      links: [{ entityType: "gig" as const, entityId: "gig-completed-repair-changed" }],
      documentType: "job_description" as const,
      title: "My synthetic care role notes",
      description: "Candidate-authored care metadata.",
      mediaType: "text/markdown" as const,
      sourceDescription: "Synthetic earlier official posting",
      filePath: null,
      uploadProvenance: null,
    },
    content: "# Earlier synthetic care posting\n\nEarlier official scope.",
  },
  {
    document: {
      id: "doc_15000000-0000-4000-8000-000000000150",
      links: [{ entityType: "gig" as const, entityId: "gig-completed-repair-unchanged" }],
      documentType: "job_description" as const,
      title: "My synthetic credit role notes",
      description: "Candidate-authored credit metadata.",
      mediaType: "text/markdown" as const,
      sourceDescription: "Synthetic current official posting",
      filePath: null,
      uploadProvenance: null,
    },
    content: "# Stable synthetic credit posting\n\nCurrent official scope.",
  },
];

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
  transaction.documents.create({
    document: identityDocument,
    content: identityDocumentContent,
    contentHash: createHash("sha256").update(identityDocumentContent).digest("hex"),
  });
  transaction.documents.create({
    document: managedDescriptionDocument,
    content: managedDescriptionContent,
    contentHash: createHash("sha256").update(managedDescriptionContent).digest("hex"),
  });
  repairDocuments.forEach(item => transaction.documents.create({
    ...item,
    contentHash: createHash("sha256").update(item.content).digest("hex"),
  }));
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
          description: {
            path: "description",
          },
        },
        detailDescription: {
          response: "json",
          request: {
            urlTemplate: "{source.origin}/details/{position.id}",
            method: "GET",
          },
          descriptionPath: "job.description",
          identity: { idPath: "job.id" },
        },
      },
    ],
  },
  new SqliteScoutCompanyImportStore(database),
);
if (scoutImport.rejected)
  throw new Error("Could not create the synthetic Scout company fixture.");

const screening = {
  profile: { summary: "Synthetic candidate" },
  profileVersion: "synthetic-profile-v1",
  profileArtifactId: "synthetic-profile-artifact",
  profileHash: "synthetic-profile-hash",
  model: "synthetic-model",
  provider: "synthetic-provider",
  modelConfiguration: "synthetic-configuration",
};
const scoutStore = new SqliteScoutRunStore(
  database,
  path.join(contextRoot, "artifacts", "gig-scout", "descriptions"),
  screening,
);
scoutStore.startOrReuse(20, 5, "2026-08-22T12:00:01.000Z");
const scoutJob = scoutStore.pendingJobs(1)[0]!;
const repairPositions = [
  {
    company: scoutJob.companyName,
    sourceKey: "official",
    externalId: "SYN-149",
    canonicalUrl: "https://careers.example.test/jobs/SYN-149",
    title: "Synthetic Health Cooperative Director",
    location: "Remote",
    workArrangement: "remote" as const,
    description: "# Current synthetic care posting\n\nCurrent official scope.",
    provenance: {
      sourceKey: "official",
      sourceUrl: "https://careers.example.test/jobs",
      description: "listing" as const,
      descriptionUrl: "https://careers.example.test/jobs/SYN-149",
    },
  },
  {
    company: scoutJob.companyName,
    sourceKey: "official",
    externalId: "SYN-150",
    canonicalUrl: "https://careers.example.test/jobs/SYN-150",
    title: "Synthetic Credit Cooperative Director",
    location: "Remote",
    workArrangement: "remote" as const,
    description: repairDocuments[1]!.content,
    provenance: {
      sourceKey: "official",
      sourceUrl: "https://careers.example.test/jobs",
      description: "listing" as const,
      descriptionUrl: "https://careers.example.test/jobs/SYN-150",
    },
  },
];
scoutStore.completeCompanyResult(
  scoutJob,
  scoutStore.prepareCompanyResult(scoutJob, {
    companyId: scoutJob.companyId,
    configurationVersionId: scoutJob.configurationVersionId,
    positions: repairPositions,
    sources: [{
      sourceKey: "official",
      status: "succeeded_with_results",
      positions: repairPositions,
      attempts: [],
    }],
  }, "2026-08-22T12:00:02.000Z"),
  "2026-08-22T12:00:02.000Z",
);
const screeningModel: ScoutScreeningModel = {
  async screenRelevance() {
    return {
      value: {
        decision: "passes_relevance",
        reason: "Synthetic leadership role",
        confidence: 0.99,
        evidence: ["Leadership"],
        ambiguities: [],
      },
      metrics: {
        provider: screening.provider,
        model: screening.model,
        modelConfiguration: screening.modelConfiguration,
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      },
    };
  },
  async scoreCandidateMatch() {
    return {
      value: { score: 9, scoreExplanation: "Synthetic candidate match" },
      metrics: {
        provider: screening.provider,
        model: screening.model,
        modelConfiguration: screening.modelConfiguration,
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      },
    };
  },
};
const processor = new ScoutPositionProcessor(
  scoutStore,
  screeningModel,
  () => "2026-08-22T12:00:03.000Z",
);
while (scoutStore.pendingPositionJobs(20)[0]) {
  await processor.process(scoutStore.pendingPositionJobs(20)[0]!.id);
}
for (const fixture of [
  { externalId: "SYN-149", gigId: "gig-completed-repair-changed", documentId: repairDocuments[0]!.document.id },
  { externalId: "SYN-150", gigId: "gig-completed-repair-unchanged", documentId: repairDocuments[1]!.document.id },
]) {
  const position = database.query(
    "SELECT id FROM scout_positions WHERE external_id=?",
  ).get(fixture.externalId) as { id: string };
  const review = scoutStore.reviewPosting(position.id)!;
  scoutStore.beginPursue({
    positionId: position.id,
    action: "pursue",
    actor: "Synthetic Reviewer",
    changeId: `synthetic-completed-${fixture.externalId}`,
    expectedStateRevision: review.detail.stateRevision,
    descriptionId: review.detail.descriptionId!,
    relevanceEvaluationId: review.detail.relevanceEvaluationId!,
    candidateMatchEvaluationId: review.detail.candidateMatchEvaluationId!,
  }, {
    kind: "use_existing",
    gigId: fixture.gigId,
    expectedGigRevision: 1,
    reviewedFingerprint: createHash("sha256").update(fixture.externalId).digest("hex"),
  }, "2026-08-22T12:00:04.000Z");
  scoutStore.completePromotion(
    position.id,
    fixture.gigId,
    fixture.documentId,
    "2026-08-22T12:00:05.000Z",
  );
}
database.close();

let encodedFixturesEnabled = false;
let identityFixturesEnabled = false;
const scoutSource = Bun.serve({
  hostname: "127.0.0.1",
  port: scoutSourcePort,
  tls: { key: scoutSourceKey, cert: scoutSourceCertificate },
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/details/encoded-recovery") {
      return Response.json({
        job: {
          id: "encoded-recovery",
          description: "&lt;h2&gt;Corrected scope&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Lead recovery teams.&lt;/li&gt;&lt;li&gt;Own resilient platforms.&lt;/li&gt;&lt;/ul&gt;",
        },
      });
    }
    if (pathname === "/details/encoded-platforms") {
      return Response.json({
        job: {
          id: "encoded-platforms",
          description: "&lt;h2&gt;Corrected platform scope&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Lead encoded platform teams.&lt;/li&gt;&lt;li&gt;Own delivery systems.&lt;/li&gt;&lt;/ul&gt;",
        },
      });
    }
    if (pathname !== "/jobs")
      return new Response("Not found", { status: 404 });
    const jobs = [
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
    ];
    if (identityFixturesEnabled) jobs.push(
      {
        id: "identity-exact",
        title: "Director of Identity Platforms",
        url: `https://127.0.0.1:${scoutSourcePort}/jobs/identity-exact`,
        workplace: "Identity East",
        description: "Lead the exact synthetic identity platform organization.",
      },
      {
        id: "identity-separate",
        title: "Director of Identity Platforms",
        url: `https://127.0.0.1:${scoutSourcePort}/jobs/identity-separate`,
        workplace: "Identity West",
        description: "Lead a separate synthetic identity platform organization.",
      },
    );
    identityFixturesEnabled = false;
    if (encodedFixturesEnabled) jobs.push(
        {
          id: "encoded-recovery",
          title: "Director of Encoded Recovery",
          url: `https://127.0.0.1:${scoutSourcePort}/jobs/encoded-recovery`,
          workplace: "Encoded Region",
          description: "&lt;h2&gt;Legacy scope&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Non-target facilities support.&lt;/li&gt;&lt;/ul&gt;",
        },
        {
          id: "encoded-platforms",
          title: "Head of Encoded Platforms",
          url: `https://127.0.0.1:${scoutSourcePort}/jobs/encoded-platforms`,
          workplace: "Encoded Region",
          description: "&lt;h2&gt;Original platform scope&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Lead encoded platform teams.&lt;/li&gt;&lt;/ul&gt;",
        },
    );
    return Response.json({ jobs });
  },
});
const screeningState = createSmokeProviderState();
const defaultScreeningHandler = smokeProviderHandler(screeningState);
const screeningProvider = Bun.serve({
  hostname: "127.0.0.1",
  port: screeningProviderPort,
  async fetch(request) {
    if (
      request.method === "POST"
      && new URL(request.url).pathname === "/fixtures/encoded"
    ) {
      encodedFixturesEnabled = true;
      return new Response(null, { status: 204 });
    }
    if (
      request.method === "POST"
      && new URL(request.url).pathname === "/fixtures/identity"
    ) {
      identityFixturesEnabled = true;
      return new Response(null, { status: 204 });
    }
    const body = request.method === "POST" ? await request.clone().text() : "";
    if (
      body.includes("GigFinder Scout's narrow relevance screener")
      && body.includes("Non-target facilities support")
    ) {
      const id = `scout_irrelevant_${screeningState.requests + 1}`;
      const itemId = `msg_${id}`;
      const value = JSON.stringify({
        decision: "fails_relevance",
        reason: "The original description is outside the configured technology scope.",
        confidence: 0.99,
        evidence: ["The description identifies non-target facilities support."],
        ambiguities: [],
      });
      const events = [
        { type: "response.created", response: { id: `resp_${id}`, created_at: 1, model: "smoke-codex" } },
        { type: "response.output_item.added", output_index: 0, item: { type: "message", id: itemId, phase: "final_answer" } },
        { type: "response.output_text.delta", item_id: itemId, delta: value },
        { type: "response.output_item.done", output_index: 0, item: { type: "message", id: itemId, phase: "final_answer" } },
        {
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 20,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 8,
              output_tokens_details: { reasoning_tokens: 0 },
            },
            incomplete_details: null,
          },
        },
      ];
      return new Response(
        events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")
          + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } },
      );
    }
    return defaultScreeningHandler(request);
  },
});

const environment = {
  ...process.env,
  PORT: apiPort,
  GIG_FINDER_CONTEXT_ROOT: contextRoot,
  AI_SDK_DEVTOOLS: "false",
  LOG_LEVEL: "error",
  NODE_TLS_REJECT_UNAUTHORIZED: "0",
  GIG_FINDER_SMOKE_MODE: "deterministic",
  GIG_FINDER_SMOKE_PROVIDER_URL: `http://127.0.0.1:${screeningProviderPort}`,
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
  void screeningProvider.stop(true);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race([api.exited, client.exited]);
stop();
