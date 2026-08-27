import { expect, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "Start full scan" }).click();

  await expect(page.getByRole("status")).toContainText("completed");
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
