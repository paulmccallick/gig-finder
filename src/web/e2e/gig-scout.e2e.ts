import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

interface PositionDetail {
  id: string;
  title: string;
  state: string;
  stateRevision: number;
  linkedGigId: string | null;
  descriptionId: string | null;
  descriptionMarkdown: string | null;
  relevanceEvaluationId: string | null;
  candidateMatchEvaluationId: string | null;
}

function promotedDocumentMetadata(positionId: string) {
  const script = [
    'import { Database } from "bun:sqlite";',
    'const database = new Database("tmp/e2e-context/data/gig-finder.sqlite", { readonly: true, strict: true });',
    'const row = database.query(`SELECT promotion.managed_document_id documentId, document.current_version currentVersion FROM scout_position_promotions promotion JOIN managed_documents document ON document.id = promotion.managed_document_id WHERE promotion.position_id = ? AND promotion.status = \'completed\'`).get(process.env.E2E_POSITION_ID);',
    'database.close();',
    'console.log(JSON.stringify(row));',
  ].join("\n");
  return JSON.parse(execFileSync("bun", ["-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, E2E_POSITION_ID: positionId },
    encoding: "utf8",
  })) as { documentId: string; currentVersion: number };
}

function positionIdByExternalId(externalId: string) {
  const script = [
    'import { Database } from "bun:sqlite";',
    'const database = new Database("tmp/e2e-context/data/gig-finder.sqlite", { readonly: true, strict: true });',
    'const row = database.query("SELECT id FROM scout_positions WHERE external_id = ?").get(process.env.E2E_EXTERNAL_ID);',
    'database.close();',
    'console.log(JSON.stringify(row));',
  ].join("\n");
  return (JSON.parse(execFileSync("bun", ["-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, E2E_EXTERNAL_ID: externalId },
    encoding: "utf8",
  })) as { id: string }).id;
}

function positionProjectionMetadata(positionId: string) {
  const script = [
    'import { Database } from "bun:sqlite";',
    'const database = new Database("tmp/e2e-context/data/gig-finder.sqlite", { readonly: true, strict: true });',
    'const row = database.query(`SELECT state.state, state.linked_gig_id linkedGigId, (SELECT relevance.id FROM scout_relevance_evaluations relevance WHERE relevance.position_id = position.id ORDER BY relevance.created_at DESC, relevance.id DESC LIMIT 1) relevanceEvaluationId, (SELECT match.id FROM scout_candidate_match_evaluations match WHERE match.position_id = position.id ORDER BY match.created_at DESC, match.id DESC LIMIT 1) candidateMatchEvaluationId FROM scout_positions position JOIN scout_position_states state ON state.position_id = position.id WHERE position.id = ?`).get(process.env.E2E_POSITION_ID);',
    'database.close();',
    'console.log(JSON.stringify(row));',
  ].join("\n");
  return JSON.parse(execFileSync("bun", ["-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, E2E_POSITION_ID: positionId },
    encoding: "utf8",
  })) as {
    state: string;
    linkedGigId: string | null;
    relevanceEvaluationId: string | null;
    candidateMatchEvaluationId: string | null;
  };
}

function storedDescriptionMetadata(positionId: string) {
  const script = [
    'import { Database } from "bun:sqlite";',
    'import { readFileSync } from "node:fs";',
    'import path from "node:path";',
    'const database = new Database("tmp/e2e-context/data/gig-finder.sqlite", { readonly: true, strict: true });',
    'const row = database.query(`SELECT artifact.file_path filePath, artifact.provenance_json provenance, configuration.version configurationVersion FROM scout_position_descriptions description JOIN scout_description_artifacts artifact ON artifact.id = description.artifact_id JOIN scout_company_configurations configuration ON configuration.id = json_extract(artifact.provenance_json, \'$.configurationVersionId\') WHERE description.position_id = ? ORDER BY description.created_at DESC, description.id DESC LIMIT 1`).get(process.env.E2E_POSITION_ID);',
    'database.close();',
    'const provenance = JSON.parse(row.provenance);',
    'console.log(JSON.stringify({ markdown: readFileSync(path.resolve("tmp/e2e-context/artifacts/gig-scout/descriptions", row.filePath), "utf8"), configurationVersion: row.configurationVersion, converterVersion: provenance.converterVersion }));',
  ].join("\n");
  return JSON.parse(execFileSync("bun", ["-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, E2E_POSITION_ID: positionId },
    encoding: "utf8",
  })) as { markdown: string; configurationVersion: number; converterVersion: string };
}

function identityGigMetadata() {
  const script = [
    'import { Database } from "bun:sqlite";',
    'const database = new Database("tmp/e2e-context/data/gig-finder.sqlite", { readonly: true, strict: true });',
    'const gigs = database.query(`SELECT id,company,title,external_job_id externalJobId,stage,outcome,last_activity lastActivity,source_url sourceUrl,location,work_arrangement workArrangement,revision FROM gigs WHERE company=\'Example Labs\' AND title=\'Director of Identity Platforms\' AND is_deleted=0 ORDER BY external_job_id`).all();',
    'const documents = database.query(`SELECT link.gig_id gigId,document.id documentId,document.current_version currentVersion,(SELECT count(*) FROM managed_document_versions version WHERE version.document_id=document.id) versionCount FROM managed_document_links link JOIN managed_documents document ON document.id=link.document_id WHERE link.gig_id IN (SELECT id FROM gigs WHERE company=\'Example Labs\' AND title=\'Director of Identity Platforms\') AND document.document_type=\'job_description\' ORDER BY link.gig_id`).all();',
    'database.close();',
    'console.log(JSON.stringify({ gigs, documents }));',
  ].join("\n");
  return JSON.parse(execFileSync("bun", ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  })) as {
    gigs: Array<{
      id: string;
      company: string;
      title: string;
      externalJobId: string;
      stage: string;
      outcome: string;
      lastActivity: string;
      sourceUrl: string;
      location: string;
      workArrangement: string | null;
      revision: number;
    }>;
    documents: Array<{
      gigId: string;
      documentId: string;
      currentVersion: number;
      versionCount: number;
    }>;
  };
}

test("starts, leaves, and reopens a persisted empty Gig Scout run", async ({
  page,
}) => {
  let submittedProfile: unknown;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/gig-scout/runs"
    ) {
      submittedProfile = request.postDataJSON();
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  await expect(
    page.getByRole("heading", { name: "Gig Scout", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading",{name:"Positions",exact:true})).toBeVisible();
  await expect(page.getByText("No positions match the active filters.")).toBeVisible();
  await page.getByRole("button",{name:"Run history"}).click();
  await expect(page.getByLabel("Search terms", { exact: true })).toHaveValue(
    /Director/,
  );
  await expect(
    page.getByLabel("Search locations", { exact: true }),
  ).toHaveValue(/Seattle/);
  await page
    .getByLabel("Search terms", { exact: true })
    .fill("nonmatching specialty");
  await page
    .getByLabel("Search locations", { exact: true })
    .fill("Nowhere");
  await page.getByRole("button", { name: "Start full scan" }).click();
  expect(submittedProfile).toEqual({
    searchProfile: {
      terms: ["nonmatching specialty"],
      locations: ["Nowhere"],
    },
  });
  await expect(page.getByRole("status")).toContainText("completed");
  await expect(page.getByLabel("Run search profile")).toContainText(
    "nonmatching specialty",
  );
  await expect(page.getByLabel("Run search profile")).toContainText(
    "Nowhere",
  );
  await page.getByRole("button", { name: /Opportunities/ }).click();
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  await page.getByRole("button",{name:"Run history"}).click();
  await expect(
    page.getByText("No positions were observed for this run."),
  ).toBeVisible();
});

test("discovers and processes positions from a full Scout run", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  await page.getByRole("button", { name: "Run history" }).click();
  await page
    .getByLabel("Search terms", { exact: true })
    .fill("synthetic systems, orchard");
  await page
    .getByLabel("Search locations", { exact: true })
    .fill("Synthetic Region");
  const runResponse = page.waitForResponse(response =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/gig-scout/runs"
  );
  await page.getByRole("button", { name: "Start full scan" }).click();

  const { run } = await (await runResponse).json() as { run: { id: string } };
  await expect.poll(async () => {
    const response = await page.request.get(`/api/gig-scout/runs/${run.id}`);
    return (await response.json() as { status: string }).status;
  }).toBe("completed");
  await page.getByText("Company diagnostics").click();
  await expect(page.getByText("2/2 accepted")).toBeVisible();

  await expect
    .poll(async () => {
      const response = await page.request.get(
        "/api/gig-scout/positions?state=actionable",
      );
      const body = (await response.json()) as {
        items: Array<{
          title: string;
          state: string;
          processingStatus: string | null;
          descriptionAvailable: boolean;
          score: number | null;
        }>;
      };
      return body.items;
    })
    .toEqual([
      expect.objectContaining({
        title: "Head of Orchard Technology",
        state: "needs_user_review",
        processingStatus: "completed",
        descriptionAvailable: true,
        score: 8,
      }),
    ]);

  await page.getByRole("button", { name: "Positions", exact: true }).click();
  const ledger = page.getByRole("region", { name: "Positions for review" });
  await expect(ledger.getByText("Head of Orchard Technology")).toBeVisible();
  await expect(ledger.getByText("8/10")).toBeVisible();
  await expect(ledger.getByText(/synthetic profile aligns/)).toBeVisible();
  await expect(ledger.getByText("First seen", { exact: true })).toBeVisible();
  await expect(ledger.getByText("Processing", { exact: true })).toHaveCount(0);
  await expect(ledger.getByText("Description", { exact: true })).toHaveCount(0);
  await expect(ledger.getByText("Observations", { exact: true })).toHaveCount(0);

  const agentPanel = page.getByRole("complementary", { name: "GigFinder" });
  const agentLauncher = page.locator(".agent-launcher");
  if (!await agentPanel.isVisible()) {
    await agentLauncher.click();
  }
  await expect(agentPanel).toBeVisible();
  const detailPattern = "**/api/gig-scout/positions/*";
  await page.route(detailPattern, async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic detail failure." }),
      });
      return;
    }
    await route.continue();
  });
  await ledger.getByRole("button", {
    name: /Head of Orchard Technology/,
  }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not open that position. Select it to try again.",
  );
  await expect(agentPanel).toBeHidden();
  await expect(agentLauncher).toBeVisible();
  await page.unroute(detailPattern);

  await agentLauncher.click();
  await expect(agentPanel).toBeVisible();
  await ledger.getByRole("button", {
    name: /Head of Orchard Technology/,
  }).click();
  await expect(page.getByRole("alert").filter({
    hasText: "Could not open that position",
  })).toHaveCount(0);
  await expect(agentPanel).toBeHidden();
  await expect(agentLauncher).toBeHidden();
  const drawer = page.getByRole("dialog", { name: "Head of Orchard Technology" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("8 / 10 match")).toBeVisible();
  await expect(drawer.getByText(/synthetic profile aligns/)).toBeVisible();
  await expect(drawer.getByLabel("Private note (optional)")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Pursue position" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Mark irrelevant" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Defer review" })).toBeVisible();

  await drawer.getByLabel("Private note (optional)").fill("Discarded draft");
  await drawer.getByRole("button", { name: "Close position review" }).click();
  await expect(agentLauncher).toBeVisible();
  await ledger.getByRole("button", { name: /Head of Orchard Technology/ }).click();
  await expect(drawer.getByLabel("Private note (optional)")).toHaveValue("");
  await expect(agentLauncher).toBeHidden();

  await drawer.getByRole("button", { name: "Expand description" }).click();
  await expect(drawer.locator(".scout-review-description")).toHaveClass(/is-expanded/);
  const popupPromise = page.waitForEvent("popup");
  await drawer.getByRole("link", {
    name: /Open Head of Orchard Technology description in document view/,
  }).click();
  const viewer = await popupPromise;
  await expect(viewer.getByRole("heading", { name: "Head of Orchard Technology" })).toBeVisible();
  await expect(viewer.getByText("Build and lead the orchard technology team.")).toBeVisible();
  await viewer.getByRole("button", { name: "Back" }).click();
  await expect.poll(() => viewer.isClosed()).toBe(true);
  await expect(drawer).toBeVisible();

  const descriptionUrl = await drawer.locator(".scout-review-document-link")
    .evaluate((link: HTMLAnchorElement) => link.href);
  const directViewer = await page.context().newPage();
  await directViewer.evaluate(url => window.location.replace(url), descriptionUrl);
  await directViewer.waitForLoadState("domcontentloaded");
  await directViewer.getByRole("button", { name: "Back" }).click();
  await expect(directViewer).toHaveURL(/\?workspace=scout$/);
  await expect(directViewer.getByRole("button", { name: "Positions", exact: true })).toBeVisible();
  await directViewer.close();

  await page.setViewportSize({ width: 700, height: 900 });
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
  await expect(drawer.locator(".scout-review-description"))
    .toHaveCSS("overflow-wrap", "anywhere");
  await page.setViewportSize({ width: 1280, height: 900 });

  let failedDecision: { action?: string; note?: string } = {};
  const decisionPattern = "**/api/gig-scout/positions/*/decision";
  await page.route(decisionPattern, async route => {
    failedDecision = route.request().postDataJSON() as typeof failedDecision;
    await new Promise(resolve => setTimeout(resolve, 200));
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic decision failure." }),
    });
  });
  await drawer.getByLabel("Private note (optional)").fill("Synthetic review note");
  const failedClick = drawer.getByRole("button", { name: "Mark irrelevant" }).click();
  await expect(drawer.getByRole("button", { name: "Mark irrelevant" })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Close position review" })).toBeDisabled();
  await failedClick;
  await expect(drawer.getByRole("alert")).toContainText("Synthetic decision failure.");
  await expect(drawer.getByLabel("Private note (optional)")).toHaveValue("Synthetic review note");
  await expect(drawer.getByRole("button", { name: "Mark irrelevant" })).toBeEnabled();
  await expect(ledger.getByText("Head of Orchard Technology")).toBeVisible();
  expect(failedDecision).toMatchObject({ action: "irrelevant", note: "Synthetic review note" });
  await page.unroute(decisionPattern);

  await page.route(decisionPattern, async route => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Position revised." }),
    });
  });
  await drawer.getByRole("button", { name: "Mark irrelevant" }).click();
  await expect(drawer.getByRole("alert")).toContainText("This position was revised");
  await expect(drawer.getByLabel("Private note (optional)")).toHaveValue("Synthetic review note");
  await page.unroute(decisionPattern);

  await drawer.getByLabel("Private note (optional)").fill("");
  await page.evaluate(() => {
    document.body.style.minHeight = "2000px";
    window.scrollTo(0, 240);
  });
  const beforeScroll = await page.evaluate(() => window.scrollY);
  let refreshAttempts = 0;
  const listPattern = "**/api/gig-scout/positions?*";
  await page.route(listPattern, async route => {
    refreshAttempts += 1;
    if (refreshAttempts === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });
  await drawer.getByRole("button", { name: "Pursue position" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(ledger.getByText("Head of Orchard Technology")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(beforeScroll);
  await expect(page.getByRole("button", { name: "Retry refresh" })).toBeVisible();
  await page.getByRole("button", { name: "Retry refresh" }).click();
  await expect(page.getByRole("button", { name: "Retry refresh" })).toHaveCount(0);
  expect(refreshAttempts).toBeGreaterThanOrEqual(2);
  await page.unroute(listPattern);
  await expect(page.getByRole("combobox", { name: "View", exact: true }))
    .toHaveValue("needs_user_review");
  await expect.poll(async()=>{const response=await page.request.get("/api/gig-scout/positions");const body=await response.json() as {items:Array<{id:string}>};return body.items.length;}).toBe(0);
});

test("review decisions keep the ledger context and retry a failed promotion", async ({ page }) => {
  const makePosition = (suffix: string, title: string, promotionFailed = false) => ({
    id: `spos_${suffix}`,
    title,
    company: "Synthetic Review Company",
    location: "Remote",
    canonicalUrl: `https://example.test/jobs/${suffix}`,
    state: "needs_user_review",
    stateRevision: 1,
    processingStage: "candidate_match",
    processingStatus: "completed",
    processingFailureMessage: null,
    descriptionAvailable: true,
    firstSeenAt: "2026-08-01T12:00:00.000Z",
    lastSeenAt: "2026-08-02T12:00:00.000Z",
    observationCount: 1,
    score: 7,
    scoreExplanation: "The synthetic role matches the candidate profile.",
    criteriaVersion: 1,
    rubricVersion: 1,
    profileVersion: "profile-v1",
    model: "synthetic-model",
    provider: "synthetic-provider",
    descriptionId: `sdesc_${suffix}`,
    descriptionMarkdown: "# Synthetic role\n\nLead a synthetic team.",
    descriptionSourceUrl: `https://example.test/jobs/${suffix}`,
    descriptionRetrievedAt: "2026-08-02T12:00:00.000Z",
    descriptionProvenance: {},
    relevanceEvaluationId: `srel_${suffix}`,
    relevanceReason: "Synthetic relevance reason.",
    candidateMatchEvaluationId: `smatch_${suffix}`,
    observations: [],
    ...(promotionFailed ? {
      promotionStatus: "failed",
      promotionFailureMessage: "Synthetic promotion failure.",
    } : {}),
  });
  const reviewPositions = [
    makePosition("a1", "Deferred Director"),
    makePosition("b2", "Irrelevant Director"),
    makePosition("c3", "Retry Director", true),
  ];
  const positions = [
    ...Array.from({ length: 20 }, (_, index) => makePosition(
      `d${index.toString(16).padStart(2, "0")}`,
      `Earlier review position ${index + 1}`,
    )),
    ...reviewPositions,
  ];
  const decisions: Array<{ action: string; note?: string }> = [];
  const listQueries: URLSearchParams[] = [];

  await page.route("**/api/gig-scout/positions?*", async route => {
    const query = new URL(route.request().url()).searchParams;
    listQueries.push(query);
    const offset = Number(query.get("offset") ?? 0);
    const limit = Number(query.get("limit") ?? 20);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: positions.slice(offset, offset + limit),
        total: positions.length,
        counts: { needs_user_review: positions.length, actionable: positions.length },
      }),
    });
  });
  await page.route("**/api/gig-scout/positions/**", async route => {
    const url = new URL(route.request().url());
    const positionId = url.pathname.split("/").at(4) ?? "";
    const index = positions.findIndex(position => position.id === positionId);
    if (route.request().method() === "POST" && url.pathname.endsWith("/decision")) {
      const decision = route.request().postDataJSON() as { action: string; note?: string };
      decisions.push(decision);
      positions.splice(index, 1);
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    if (route.request().method() === "POST" && url.pathname.endsWith("/promotion/retry")) {
      positions.splice(index, 1);
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    const position = positions[index];
    await route.fulfill({
      status: position ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(position ?? { error: "Not found" }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  const ledger = page.getByRole("region", { name: "Positions for review" });
  await page.getByRole("combobox", { name: "Sort" }).selectOption("score");
  await page.getByPlaceholder("Company").fill("Synthetic Review Company");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("21–23 of 23")).toBeVisible();

  await ledger.getByRole("button", { name: /Deferred Director/ }).click();
  let drawer = page.getByRole("dialog", { name: "Deferred Director" });
  await drawer.getByLabel("Private note (optional)").fill("Review after planning.");
  await drawer.getByLabel("Review again at").fill("2026-09-01T09:00");
  await drawer.getByRole("button", { name: "Defer review" }).click();
  await expect.poll(() => decisions.length).toBe(1);
  await expect(ledger.getByText("Deferred Director")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("score");
  await expect(page.getByPlaceholder("Company")).toHaveValue("Synthetic Review Company");
  expect(decisions.at(0)).toMatchObject({ action: "defer", note: "Review after planning." });

  await ledger.getByRole("button", { name: /Irrelevant Director/ }).click();
  drawer = page.getByRole("dialog", { name: "Irrelevant Director" });
  await drawer.getByLabel("Private note (optional)").fill("Outside my leadership scope.");
  await drawer.getByRole("button", { name: "Mark irrelevant" }).click();
  await expect(ledger.getByText("Irrelevant Director")).toHaveCount(0);
  expect(decisions.at(1)).toMatchObject({
    action: "irrelevant",
    note: "Outside my leadership scope.",
  });

  await ledger.getByRole("button", { name: /Retry Director/ }).click();
  drawer = page.getByRole("dialog", { name: "Retry Director" });
  await expect(drawer.getByText("Synthetic promotion failure.")).toBeVisible();
  await drawer.getByRole("button", { name: "Retry promotion" }).click();
  await expect(ledger.getByText("Retry Director")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "View" }))
    .toContainText("needs user review (20)");
  await expect(page.getByText("1–20 of 20")).toBeVisible();
  expect(listQueries.at(-1)?.get("offset")).toBe("0");
  expect(listQueries.at(-1)?.get("sort")).toBe("score");
  expect(listQueries.at(-1)?.get("company")).toBe("Synthetic Review Company");
});

test("posting identity resolution stays in the review drawer until an explicit choice succeeds", async ({ page }) => {
  const makePosition = (suffix: string, requisition: string) => ({
    id: `spos_${suffix}`,
    title: "Director of Identity Platforms",
    company: "Example Payments",
    location: "Bellevue, WA",
    canonicalUrl: `https://careers.example.test/jobs/${requisition}`,
    externalId: requisition,
    state: "needs_user_review",
    stateRevision: 1,
    processingStage: "candidate_match",
    processingStatus: "completed",
    processingFailureMessage: null,
    descriptionAvailable: true,
    firstSeenAt: "2026-08-30T12:00:00.000Z",
    lastSeenAt: "2026-09-01T12:00:00.000Z",
    observationCount: 1,
    score: 9,
    scoreExplanation: "Synthetic identity leadership evidence.",
    criteriaVersion: 1,
    rubricVersion: 1,
    profileVersion: "profile-v1",
    model: "synthetic-model",
    provider: "synthetic-provider",
    descriptionId: `spdesc_${suffix}`,
    descriptionMarkdown: `# ${requisition}\n\nLead identity platforms.`,
    descriptionSourceUrl: `https://careers.example.test/jobs/${requisition}`,
    descriptionRetrievedAt: "2026-09-01T12:00:00.000Z",
    descriptionProvenance: {},
    relevanceEvaluationId: `srel_${suffix}`,
    relevanceReason: "Relevant.",
    candidateMatchEvaluationId: `smatch_${suffix}`,
    observations: [],
  });
  const candidate = (revision: number, fingerprintSuffix: string) => ({
    gigId: "gig-existing-identity",
    revision,
    company: "Example Payments",
    title: "Director of Identity Platforms",
    externalJobId: "REQ-OLD",
    sourceUrl: "https://careers.example.test/jobs/REQ-OLD",
    location: "Remote",
    stage: "applied",
    outcome: "pending",
    availability: "available",
    lastActivity: "2026-08-29",
    jobDescription: {
      id: "doc_11111111-1111-4111-8111-111111111111",
      type: "job_description",
      title: "Existing identity role",
      displayName: "Existing identity role",
      version: revision,
    },
    matchReasons: ["company_title"],
    fingerprintSuffix,
  });
  const positions = [
    makePosition("1111111111111111", "REQ-NEW"),
    makePosition("2222222222222222", "REQ-NO-CANDIDATE"),
  ];
  const decisions: Array<Record<string, unknown>> = [];
  let evidenceRevision = 1;
  let createAttempts = 0;

  await page.context().route("**/api/gig-scout/positions?*", async route => {
    const query = new URL(route.request().url()).searchParams;
    const filtered = positions.filter(position => !query.get("company")
      || position.company.includes(query.get("company") ?? ""));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: filtered,
        total: filtered.length,
        counts: { needs_user_review: filtered.length, actionable: filtered.length },
      }),
    });
  });
  await page.context().route("**/api/documents/doc_11111111-1111-4111-8111-111111111111/versions/*", async route => {
    const version = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reference: "doc_11111111-1111-4111-8111-111111111111",
        storage: "managed",
        displayName: "Existing identity role",
        documentType: "job_description",
        mediaType: "text/markdown",
        version,
        currentVersion: version,
        content: "# Existing identity role\n\nStored Gig description.",
      }),
    });
  });
  await page.context().route("**/api/gig-scout/positions/**", async route => {
    const url = new URL(route.request().url());
    const positionId = url.pathname.split("/").at(4) ?? "";
    const index = positions.findIndex(position => position.id === positionId);
    if (route.request().method() === "POST" && url.pathname.endsWith("/decision")) {
      const decision = route.request().postDataJSON() as Record<string, unknown>;
      decisions.push(decision);
      if (positionId.endsWith("2222222222222222")) {
        positions.splice(index, 1);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "created", position: null }) });
        return;
      }
      const resolution = decision.resolution as { kind?: string } | undefined;
      if (!resolution) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "resolution_required", fingerprint: "a".repeat(64), candidates: [candidate(evidenceRevision, "initial")] }) });
        return;
      }
      if (resolution.kind === "use_existing") {
        await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Could not update the selected Gig. Try again." }) });
        return;
      }
      createAttempts += 1;
      if (createAttempts === 1) {
        evidenceRevision = 2;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "resolution_stale", fingerprint: "b".repeat(64), candidates: [candidate(evidenceRevision, "refreshed")] }) });
        return;
      }
      positions.splice(index, 1);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "created", position: null }) });
      return;
    }
    const position = positions[index];
    await route.fulfill({
      status: position ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(position ?? { error: "Not found" }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  await page.getByPlaceholder("Company").fill("Example Payments");
  const ledger = page.getByRole("region", { name: "Positions for review" });
  const rows = ledger.locator(".scout-review-row");
  await expect(rows).toHaveCount(2);
  await rows.first().click();
  const drawer = page.getByRole("dialog", { name: "Director of Identity Platforms" });
  await drawer.getByRole("button", { name: "Pursue position" }).click();
  await expect(drawer.getByText("Reviewed Scout posting")).toBeVisible();
  const existing = drawer.locator(".scout-resolution-record").filter({ hasText: "REQ-OLD" });
  await expect(existing).toContainText("Example Payments");
  await expect(existing).toContainText("Director of Identity Platforms");
  await expect(existing).toContainText("Remote");
  await expect(existing).toContainText("Applied / Pending");
  await expect(existing).toContainText("Available");
  await expect(existing).toContainText("Aug 29, 2026");
  await expect(existing.getByRole("link", { name: "Open stored description" }))
    .toHaveAttribute("href", "/documents/doc_11111111-1111-4111-8111-111111111111/versions/1");
  await expect(drawer.getByRole("link", { name: "Open Scout description" }))
    .toHaveAttribute("href", "/gig-scout/positions/spos_1111111111111111/description");
  let popupPromise = page.waitForEvent("popup");
  await existing.getByRole("link", { name: "Open stored description" }).click();
  let descriptionViewer = await popupPromise;
  await expect(descriptionViewer.locator(".document-viewer-title").getByRole("heading", { name: "Existing identity role" })).toBeVisible();
  await expect(descriptionViewer.getByText("Stored Gig description.")).toBeVisible();
  await descriptionViewer.getByRole("button", { name: "Back" }).click();
  await expect.poll(() => descriptionViewer.isClosed()).toBe(true);
  popupPromise = page.waitForEvent("popup");
  await drawer.getByRole("link", { name: "Open Scout description" }).click();
  descriptionViewer = await popupPromise;
  await expect(descriptionViewer.getByRole("heading", { name: "Director of Identity Platforms" })).toBeVisible();
  await expect(descriptionViewer.getByText("Lead identity platforms.")).toBeVisible();
  await descriptionViewer.getByRole("button", { name: "Back" }).click();
  await expect.poll(() => descriptionViewer.isClosed()).toBe(true);

  await existing.getByRole("button", { name: "Use this Gig" }).click();
  await expect(drawer.getByRole("alert")).toContainText("Could not update the selected Gig");
  await expect(existing).toHaveClass(/is-selected/);
  await expect(rows).toHaveCount(2);

  await drawer.getByRole("button", { name: "Create separate Gig" }).click();
  await expect(drawer.getByRole("alert")).toContainText("evidence changed");
  await expect(drawer.getByRole("link", { name: "Open stored description" }))
    .toHaveAttribute("href", "/documents/doc_11111111-1111-4111-8111-111111111111/versions/2");
  await expect(drawer).toBeVisible();

  await page.evaluate(() => {
    document.body.style.minHeight = "1800px";
    window.scrollTo(0, 220);
  });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await drawer.getByRole("button", { name: "Create separate Gig" }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByPlaceholder("Company")).toHaveValue("Example Payments");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  await rows.first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Pursue position" }).click();
  await expect(rows).toHaveCount(0);
  expect(decisions[0]).not.toHaveProperty("resolution");
  expect(decisions[1]?.resolution).toMatchObject({
    kind: "use_existing",
    reviewedFingerprint: "a".repeat(64),
    gigId: "gig-existing-identity",
    expectedGigRevision: 1,
  });
  expect(decisions[2]?.resolution).toEqual({
    kind: "create_new",
    reviewedFingerprint: "a".repeat(64),
  });
  expect(decisions[3]?.resolution).toEqual({
    kind: "create_new",
    reviewedFingerprint: "b".repeat(64),
  });
  expect(decisions.at(-1)).not.toHaveProperty("note");
});

test("posting identity resolution keeps same-title requisitions separate and updates an exact Gig", async ({ page }) => {
  const enabled = await page.request.post("http://127.0.0.1:3004/fixtures/identity");
  expect(enabled.status()).toBe(204);
  const started = await page.request.post("/api/gig-scout/runs", {
    data: {
      searchProfile: {
        terms: ["identity platforms"],
        locations: ["Identity East", "Identity West"],
      },
    },
  });
  expect(started.status()).toBe(202);
  const { run } = await started.json() as { run: { id: string } };
  await expect.poll(async () => {
    const response = await page.request.get(`/api/gig-scout/runs/${run.id}`);
    return (await response.json() as { status: string }).status;
  }).toBe("completed");
  await expect.poll(async () => {
    const response = await page.request.get(
      "/api/gig-scout/positions?state=needs_user_review&text=Identity%20Platforms",
    );
    const body = await response.json() as { items: Array<{ title: string }> };
    return body.items.filter(position => position.title === "Director of Identity Platforms").length;
  }, { timeout: 20_000 }).toBe(2);

  await page.goto("/");
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  const ledger = page.getByRole("region", { name: "Positions for review" });
  await expect(ledger.getByText("Director of Identity Platforms")).toHaveCount(2);

  await ledger.getByRole("button", { name: /Identity West/ }).click();
  let drawer = page.getByRole("dialog", { name: "Director of Identity Platforms" });
  await drawer.getByRole("button", { name: "Pursue position" }).click();
  const advisory = drawer.locator(".scout-resolution-record").filter({ hasText: "IDENTITY-EXACT" });
  await expect(advisory).toBeVisible();
  await expect(advisory).toContainText("Applied / Pending");
  await drawer.getByRole("button", { name: "Create separate Gig" }).click();
  await expect(ledger.getByRole("button", { name: /Identity West/ })).toHaveCount(0);
  const separateMetadata = identityGigMetadata();
  expect(separateMetadata.gigs).toHaveLength(2);
  expect(separateMetadata.gigs.find(gig => gig.externalJobId === "identity-separate")).toMatchObject({
    company: "Example Labs",
    title: "Director of Identity Platforms",
    externalJobId: "identity-separate",
    sourceUrl: "https://127.0.0.1:3003/jobs/identity-separate",
  });

  await ledger.getByRole("button", { name: /Identity East/ }).click();
  drawer = page.getByRole("dialog", { name: "Director of Identity Platforms" });
  await drawer.getByRole("button", { name: "Pursue position" }).click();
  const exact = drawer.locator(".scout-resolution-record").filter({ hasText: "IDENTITY-EXACT" });
  await exact.getByRole("button", { name: "Use this Gig" }).click();
  await expect(ledger.getByRole("button", { name: /Identity East/ })).toHaveCount(0);

  const metadata = identityGigMetadata();
  expect(metadata.gigs).toHaveLength(2);
  expect(metadata.gigs.find(gig => gig.externalJobId === "identity-exact")).toMatchObject({
    stage: "applied",
    outcome: "pending",
    lastActivity: "2026-08-20",
    sourceUrl: "https://127.0.0.1:3003/jobs/identity-exact",
    location: "Identity East",
  });
  const exactGig = metadata.gigs.find(gig => gig.externalJobId === "identity-exact");
  expect(metadata.documents.find(document => document.gigId === exactGig?.id)).toMatchObject({
    currentVersion: 2,
    versionCount: 2,
  });
});

test("reprocesses encoded descriptions through review and promoted document projection", async ({ page }) => {
  test.slow();
  const enabled = await page.request.post("http://127.0.0.1:3004/fixtures/encoded");
  expect(enabled.status()).toBe(204);
  const started = await page.request.post("/api/gig-scout/runs", {
    data: {
      searchProfile: {
        terms: ["encoded"],
        locations: ["Encoded Region"],
      },
    },
  });
  expect(started.status()).toBe(202);
  const { run } = await started.json() as { run: { id: string } };

  await expect.poll(async () => {
    const response = await page.request.get(`/api/gig-scout/runs/${run.id}`);
    return (await response.json() as { status: string }).status;
  }).toBe("completed");

  const runPositionsResponse = await page.request.get(
    `/api/gig-scout/runs/${run.id}/positions?limit=20`,
  );
  expect(runPositionsResponse.ok()).toBe(true);
  const runPositions = await runPositionsResponse.json() as {
    items: Array<{ id: string; title: string }>;
  };
  expect(runPositions.items.find(
    position => position.title === "Director of Encoded Recovery",
  )).toBeDefined();
  expect(runPositions.items.find(
    position => position.title === "Head of Encoded Platforms",
  )).toBeDefined();
  const irrelevantPositionId = positionIdByExternalId("encoded-recovery");
  const promotedPositionId = positionIdByExternalId("encoded-platforms");
  expect(irrelevantPositionId).toMatch(/^spos_/);
  expect(promotedPositionId).toMatch(/^spos_/);
  expect(storedDescriptionMetadata(irrelevantPositionId)).toMatchObject({
    markdown: expect.stringContaining("&lt;h2&gt;Legacy scope&lt;/h2&gt;"),
    configurationVersion: 1,
  });

  const position = async (positionId: string) => {
    const response = await page.request.get(`/api/gig-scout/positions/${positionId}`);
    expect(response.ok()).toBe(true);
    return await response.json() as PositionDetail;
  };
  await expect.poll(async () => {
    const response = await page.request.post(
      "/api/gig-scout/positions/backfill/preview",
      {
        data: {
          positionIds: [irrelevantPositionId, promotedPositionId],
          reason: "Observe initial E2E processing",
        },
      },
    );
    const preview = await response.json() as {
      accepted: Array<{ positionId: string; state: string }>;
    };
    return Object.fromEntries(preview.accepted.map(item => [item.positionId, item.state]));
  }, { timeout: 20_000 }).toEqual({
    [irrelevantPositionId]: "irrelevant",
    [promotedPositionId]: "needs_user_review",
  });
  const irrelevantBefore = positionProjectionMetadata(irrelevantPositionId);
  const promotedBefore = await position(promotedPositionId);

  const promotion = await page.request.post(
    `/api/gig-scout/positions/${promotedPositionId}/decision`,
    {
      data: {
        action: "pursue",
        changeId: "e2e-promote-encoded-position",
        expectedStateRevision: promotedBefore.stateRevision,
        descriptionId: promotedBefore.descriptionId,
        relevanceEvaluationId: promotedBefore.relevanceEvaluationId,
        candidateMatchEvaluationId: promotedBefore.candidateMatchEvaluationId,
      },
    },
  );
  expect(promotion.ok()).toBe(true);
  expect(await promotion.json()).toEqual({ status: "created", position: null });
  expect(positionProjectionMetadata(promotedPositionId)).toMatchObject({
    state: "promoted",
    linkedGigId: expect.stringMatching(/^gig_/),
  });
  const documentBefore = promotedDocumentMetadata(promotedPositionId!);

  const upgraded = await page.request.post("/api/gig-scout/companies", {
    data: {
      id: "company-e2e-scout",
      name: "Example Labs",
      active: true,
      sources: [{
        key: "official",
        type: "json",
        url: "https://127.0.0.1:3003/jobs",
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
            contentFormat: "html",
            contentEncoding: "html-entities",
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
          contentFormat: "html",
          contentEncoding: "html-entities",
        },
      }],
    },
  });
  expect(upgraded.status()).toBe(201);
  expect(await upgraded.json()).toEqual({
    created: 0,
    unchanged: 0,
    versioned: 1,
    rejected: 0,
  });

  const command = {
    positionIds: [irrelevantPositionId!, promotedPositionId!],
    reason: "E2E encoded description correction",
  };
  const preview = await page.request.post(
    "/api/gig-scout/positions/backfill/preview",
    { data: command },
  );
  expect(preview.ok()).toBe(true);
  expect(await preview.json()).toMatchObject({
    requested: 2,
    accepted: expect.arrayContaining([
      expect.objectContaining({ positionId: irrelevantPositionId }),
      expect.objectContaining({ positionId: promotedPositionId }),
    ]),
    rejected: [],
  });

  const start = await page.request.post("/api/gig-scout/positions/backfill", {
    data: command,
  });
  expect(start.status()).toBe(202);
  const backfill = await start.json() as { runId: string };
  await expect.poll(async () => {
    const response = await page.request.get(
      `/api/gig-scout/positions/backfill/${backfill.runId}`,
    );
    const status = await response.json() as {
      stages: Record<string, { pending: number; failed: number }>;
      gigDocuments: { updated: number; failed: number };
    };
    return {
      pending: Object.values(status.stages).reduce(
        (count, stage) => count + stage.pending,
        0,
      ),
      failed: Object.values(status.stages).reduce(
        (count, stage) => count + stage.failed,
        0,
      ),
      gigDocuments: status.gigDocuments,
    };
  }, { timeout: 60_000 }).toEqual({
    pending: 0,
    failed: 0,
    gigDocuments: expect.objectContaining({ updated: 1, failed: 0 }),
  });

  const irrelevantAfter = await position(irrelevantPositionId);
  const irrelevantProjectionAfter = positionProjectionMetadata(irrelevantPositionId);
  const promotedAfter = positionProjectionMetadata(promotedPositionId);
  expect(irrelevantAfter.state).toBe("needs_user_review");
  expect(irrelevantProjectionAfter).toMatchObject({
    state: "needs_user_review",
    linkedGigId: null,
  });
  expect(irrelevantAfter.relevanceEvaluationId)
    .not.toBe(irrelevantBefore.relevanceEvaluationId);
  expect(irrelevantAfter.candidateMatchEvaluationId).not.toBeNull();
  expect(promotedAfter).toMatchObject({
    state: "promoted",
    linkedGigId: expect.stringMatching(/^gig_/),
  });
  expect(promotedAfter.candidateMatchEvaluationId)
    .not.toBe(promotedBefore.candidateMatchEvaluationId);

  const documentAfter = promotedDocumentMetadata(promotedPositionId!);
  expect(documentAfter).toEqual({
    documentId: documentBefore.documentId,
    currentVersion: documentBefore.currentVersion + 1,
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  const ledger = page.getByRole("region", { name: "Positions for review" });
  await expect(ledger.getByText("Director of Encoded Recovery")).toBeVisible();
  await expect(ledger.getByText("Head of Encoded Platforms")).toHaveCount(0);
  await ledger.getByRole("button", { name: /Director of Encoded Recovery/ }).click();
  const drawer = page.getByRole("dialog", { name: "Director of Encoded Recovery" });
  await drawer.getByRole("button", { name: "Expand description" }).click();
  const markdown = drawer.locator(".scout-review-description");
  await expect(markdown).toContainText("## Corrected scope");
  await expect(markdown).toContainText("Lead recovery teams.");
  await expect(markdown).not.toContainText("&lt;");
  const popupPromise = page.waitForEvent("popup");
  await drawer.getByRole("link", {
    name: /Open Director of Encoded Recovery description in document view/,
  }).click();
  const viewer = await popupPromise;
  await expect(viewer.getByRole("heading", { name: "Corrected scope" })).toBeVisible();
  await expect(viewer.getByRole("listitem").filter({
    hasText: "Lead recovery teams.",
  })).toBeVisible();
  await expect(viewer.locator("main")).not.toContainText("&lt;");
});
